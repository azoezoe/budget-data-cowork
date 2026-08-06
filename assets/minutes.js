const state = {
  payload: null,
  rows: [],
  edits: {},
  addedRows: [],
  selectedKey: "",
  filter: "pending",
  search: "",
  reviewer: "",
  storageKey: "",
  sourceSelection: "",
};

const dataPath = window.MINUTES_REVIEW_DATA || "data/minutes-review.json";
const requiredFields = ["預算年度", "full_name", "result"];

function rowKey(row) {
  return row.row_id;
}

function currentEdit(row) {
  return state.edits[rowKey(row)] || {};
}

function currentFields(row) {
  return { ...row.fields, ...(currentEdit(row).fields || {}) };
}

function currentReview(row) {
  return {
    done: false,
    flagged: false,
    decision: row.added ? "add" : "",
    correction: "",
    note: "",
    fullNameDirty: false,
    fullNameEdited: false,
    resultDirty: false,
    resultEdited: false,
    ...(currentEdit(row).review || {}),
  };
}

function saveState() {
  localStorage.setItem(
    state.storageKey,
    JSON.stringify({
      edits: state.edits,
      addedRows: state.addedRows,
      selectedKey: state.selectedKey,
      reviewer: state.reviewer,
    }),
  );
}

function savePatch(row, patch) {
  const key = rowKey(row);
  state.edits[key] = {
    ...(state.edits[key] || {}),
    ...patch,
    fields: { ...(state.edits[key]?.fields || {}), ...(patch.fields || {}) },
    review: { ...(state.edits[key]?.review || {}), ...(patch.review || {}) },
  };
  saveState();
}

function setField(row, field, value) {
  savePatch(row, { fields: { [field]: value } });
}

function setUserFullName(row, value) {
  savePatch(row, {
    fields: { full_name: value },
    review: { fullNameDirty: true, done: false },
  });
}

function propagateFullName(row, value) {
  const start = state.rows.indexOf(row);
  let count = 0;
  for (const candidate of state.rows.slice(start + 1)) {
    const review = currentReview(candidate);
    if (review.fullNameDirty || review.fullNameEdited) break;
    if (currentFields(candidate).full_name === value) continue;
    savePatch(candidate, { fields: { full_name: value } });
    count += 1;
  }
  return count;
}

function setUserResult(row, value) {
  savePatch(row, {
    fields: { result: value },
    review: { resultDirty: true, done: false },
  });
}

function propagateResult(row, value) {
  const start = state.rows.indexOf(row);
  let count = 0;
  for (const candidate of state.rows.slice(start + 1)) {
    const review = currentReview(candidate);
    if (review.resultDirty || review.resultEdited) break;
    if (currentFields(candidate).result === value) continue;
    savePatch(candidate, { fields: { result: value } });
    count += 1;
  }
  return count;
}

function issueList(row) {
  const fields = currentFields(row);
  const review = currentReview(row);
  if (review.decision === "delete") return [];
  const issues = [];
  if (fields["預算年度"] !== "115") {
    issues.push({ code: "year", label: "年度不是 115", detail: `目前：${fields["預算年度"] || "空白"}`, tone: "critical", blocking: true });
  }
  if (!fields.full_name || fields.full_name === "立法院") {
    issues.push({ code: "organization", label: "full_name 待確認", detail: row.suggested_full_name ? `文字建議：${row.suggested_full_name}` : "尚未辨識到部會", tone: "critical", blocking: true });
  }
  if (!fields.result) {
    issues.push({ code: "result", label: "result 未填", detail: "確認是通過或保留", tone: "critical", blocking: true });
  }
  if (row.added && !fields.action) {
    issues.push({ code: "action", label: "action 未填", detail: "新增提案要選擇處理類型", tone: "critical", blocking: true });
  }
  if (row.added && !(fields["內容"] || "").trim()) {
    issues.push({ code: "content", label: "內容未填", detail: "請貼上或輸入原始議事錄文字", tone: "critical", blocking: true });
  }
  if ((fields.action || "").includes("減列") && !fields.deleted) {
    issues.push({ code: "deleted", label: "缺 deleted", detail: "減列案應確認減列金額", tone: "critical", blocking: false });
  }
  if ((fields.action || "").includes("凍結") && !fields.frozen) {
    issues.push({ code: "frozen", label: "缺 frozen", detail: "凍結案應確認凍結金額", tone: "critical", blocking: false });
  }
  if (fields.extract_notes) {
    issues.push({ code: "extract", label: "AI 提醒", detail: fields.extract_notes, tone: "info", blocking: false });
  }
  if (/歲入|增列/.test(fields["內容"] || "")) {
    issues.push({ code: "remove", label: "檢查是否不匯入", detail: "內容提到歲入或增列", tone: "warning", blocking: false });
  }
  const cost = Number(String(fields.cost || "").replaceAll(",", ""));
  if (Number.isFinite(cost) && cost >= 100_000_000_000) {
    issues.push({ code: "large", label: "大額預算", detail: "請額外抽查 cost 位數", tone: "warning", blocking: false });
  }
  return issues;
}

function rowStatus(row) {
  const review = currentReview(row);
  if (review.flagged) return "flagged";
  if (review.done) return review.decision || "done";
  return "pending";
}

function visibleRows() {
  const query = state.search.trim().toLowerCase();
  return state.rows.filter((row) => {
    const fields = currentFields(row);
    const status = rowStatus(row);
    const issues = issueList(row);
    if (state.filter === "pending" && status !== "pending" && status !== "flagged") return false;
    if (state.filter === "amend" && status !== "amend") return false;
    if (state.filter === "done" && ["pending", "flagged"].includes(status)) return false;
    if (!query) return true;
    return [fields["序號"], fields.full_name, fields["內容"], fields.action, fields.result]
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
}

function selectedRow() {
  return state.rows.find((row) => rowKey(row) === state.selectedKey) || state.rows[0];
}

function selectRow(row) {
  if (!row) return;
  state.selectedKey = rowKey(row);
  saveState();
  clearSourceHighlight();
  render();
  document.querySelector(`.row-item[data-key="${CSS.escape(state.selectedKey)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function clearSourceHighlight() {
  const doc = document.querySelector("#sourceFrame")?.contentDocument;
  for (const active of doc?.querySelectorAll(".active-proposal") || []) active.classList.remove("active-proposal");
  const label = document.querySelector("#sourceLocation");
  if (label) label.textContent = "可自由捲動、選取原文";
}

function formatAmount(value) {
  const cleaned = String(value || "").replaceAll(",", "").trim();
  if (!cleaned || !/^\d+$/.test(cleaned)) return "";
  return `${Number(cleaned).toLocaleString("zh-TW")} 元`;
}

function appendHighlightedText(container, text) {
  container.textContent = "";
  const pattern = /(【[^】]+】|(?:減列|刪減|刪除|凍結|保留|歲入|增列)|[0-9０-９一二兩三四五六七八九十百千萬億兆,，.．]+\s*元)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    const mark = document.createElement("mark");
    const token = match[0];
    mark.textContent = token;
    if (token.startsWith("【")) mark.className = "case-token";
    else if (/減列|刪減|刪除|凍結|保留|歲入|增列/.test(token)) mark.className = "operation-token";
    container.append(mark);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function renderList() {
  const list = document.querySelector("#rowList");
  const rows = visibleRows();
  list.textContent = "";
  for (const row of rows) {
    const fields = currentFields(row);
    const status = rowStatus(row);
    const issues = issueList(row);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `row-item ${rowKey(row) === state.selectedKey ? "active" : ""} ${!["pending", "flagged"].includes(status) ? "done" : ""}`;
    button.dataset.key = rowKey(row);

    const index = document.createElement("span");
    index.className = "row-index";
    index.textContent = row.added ? "+" : row.row_id;
    const copy = document.createElement("span");
    copy.className = "row-copy";
    const strong = document.createElement("strong");
    strong.textContent = `案 ${fields["序號"] || "未填"}`;
    const detail = document.createElement("span");
    detail.textContent = `${fields.action || "未分類"} · ${fields.full_name || "部會未填"}`;
    copy.append(strong, detail);
    const alert = document.createElement("span");
    alert.className = "row-alert";
    if (status === "correct") {
      alert.classList.add("complete");
      alert.textContent = "✓";
    } else if (status === "amend") {
      alert.classList.add("amend");
      alert.textContent = "修正";
    } else if (status === "delete") {
      alert.classList.add("excluded");
      alert.textContent = "刪除";
    } else if (status === "add") {
      alert.classList.add("added");
      alert.textContent = "新增";
    } else {
      alert.textContent = issues.length || "·";
    }
    button.append(index, copy, alert);
    button.addEventListener("click", () => selectRow(row));
    list.append(button);
  }
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = "這個篩選沒有資料。";
    empty.style.padding = "12px 6px";
    empty.style.color = "#65717b";
    empty.style.fontSize = "12px";
    list.append(empty);
  }
}

function renderSummary() {
  const done = state.rows.filter((row) => !["pending", "flagged"].includes(rowStatus(row))).length;
  const total = state.rows.length;
  document.querySelector("#progressText").textContent = `${done} / ${total}`;
  document.querySelector("#progressBar").style.width = `${total ? (done / total) * 100 : 0}%`;
  const yearIssues = state.rows.filter((row) => currentReview(row).decision !== "delete" && currentFields(row)["預算年度"] !== "115").length;
  document.querySelector("#yearFixLabel").textContent = yearIssues ? `修正 ${yearIssues} 筆年度` : "年度已是 115";
  document.querySelector("#fixYears").disabled = yearIssues === 0;
}

function renderCurrent() {
  const row = selectedRow();
  if (!row) return;
  const fields = currentFields(row);
  const review = currentReview(row);
  const issues = issueList(row);
  const position = state.rows.indexOf(row);

  document.querySelector("#rowPosition").textContent = `第 ${position + 1} 筆，共 ${state.rows.length} 筆 · source_row ${row.source_row}`;
  document.querySelector("#caseLabel").textContent = `案號 ${fields["序號"] || "未填"}`;
  document.querySelector("#sectionLabel").textContent = fields["預算部分"] || "尚未辨識預算部分";
  document.querySelector("#contextCallout").textContent = row.section_context || "這筆沒有擷取到段落標題，請用前後提案及原始議事錄確認部會邊界。";
  appendHighlightedText(document.querySelector("#proposalContent"), fields["內容"] || "");

  const chips = document.querySelector("#issueChips");
  chips.textContent = "";
  for (const issue of issues.slice(0, 5)) {
    const chip = document.createElement("span");
    chip.className = `issue-chip ${issue.tone}`;
    chip.textContent = issue.label;
    chips.append(chip);
  }
  if (!issues.length) {
    const chip = document.createElement("span");
    chip.className = "issue-chip info";
    chip.textContent = "沒有自動提醒";
    chips.append(chip);
  }

  const attention = document.querySelector("#attentionPanel");
  attention.textContent = "";
  attention.hidden = issues.length === 0;
  for (const issue of issues) {
    const line = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${issue.label}：`;
    line.append(strong, document.createTextNode(issue.detail));
    attention.append(line);
  }

  for (const input of document.querySelectorAll("[data-field]")) {
    input.value = fields[input.dataset.field] || "";
  }
  for (const button of document.querySelectorAll("#actionControl button")) {
    button.classList.toggle("active", button.dataset.action === fields.action);
  }
  for (const preview of document.querySelectorAll("[data-amount-preview]")) {
    preview.textContent = formatAmount(fields[preview.dataset.amountPreview]);
  }

  document.querySelector("#reviewNote").value = review.note || "";
  for (const button of document.querySelectorAll("#reviewDecisionControl button")) {
    button.classList.toggle("active", button.dataset.decision === review.decision);
    button.disabled = button.dataset.decision === "add" ? !row.added : Boolean(row.added);
  }
  document.querySelector("#markProblem").classList.toggle("active", review.flagged);
  document.querySelector("#markProblem").lastChild.textContent = review.flagged ? " 已標記" : " 稍後再看";
  document.querySelector("#applyOrganization").disabled = !row.suggested_full_name || row.suggested_full_name === fields.full_name;
  document.querySelector("#applyOrganization").title = row.suggested_full_name ? `採用 ${row.suggested_full_name}` : "沒有可用建議";

  const previous = state.rows[position - 1];
  const next = state.rows[position + 1];
  document.querySelector("#previousRow").disabled = !previous;
  document.querySelector("#nextRow").disabled = !next;
}

function normalizeSourceText(value) {
  return String(value || "")
    .replace(/[\s\u3000]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[，。；：、（）()「」『』【】]/g, "");
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function findSourceElement(doc, row) {
  const target = normalizeSourceText(currentFields(row)["內容"]);
  if (!target) return null;
  let best = null;
  let bestScore = 0;
  for (const element of doc.querySelectorAll("[data-source-block]")) {
    const candidate = normalizeSourceText(element.textContent);
    const prefixScore = commonPrefixLength(target, candidate);
    const containsScore = candidate.includes(target.slice(0, 28)) ? 28 : 0;
    const score = Math.max(prefixScore, containsScore);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return bestScore >= 12 ? best : null;
}

function focusSourceParagraph(row) {
  const frame = document.querySelector("#sourceFrame");
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  for (const active of doc.querySelectorAll(".active-proposal")) active.classList.remove("active-proposal");
  const paragraph = findSourceElement(doc, row) || doc.getElementById(`p-${row.start_paragraph}`);
  const label = document.querySelector("#sourceLocation");
  if (!paragraph) {
    label.textContent = "原始議事錄已開啟，這筆請用內容手動比對";
    return;
  }
  paragraph.classList.add("active-proposal");
  paragraph.scrollIntoView({ block: "center" });
  const sourceNumber = paragraph.dataset.sourceBlock;
  label.textContent = sourceNumber
    ? `已定位到原始 HTML 第 ${sourceNumber} 段`
    : `原始議事錄第 ${row.start_paragraph} 段，已對應目前提案`;
}

function render() {
  renderList();
  renderSummary();
  renderCurrent();
}

function move(direction) {
  const row = selectedRow();
  const index = state.rows.indexOf(row);
  selectRow(state.rows[index + direction]);
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2600);
}

function confirmAndNext() {
  const row = selectedRow();
  const review = currentReview(row);
  const fields = currentFields(row);
  if (!review.decision) {
    showToast("請先選擇無誤、有修正或刪除");
    return;
  }
  const blocking = ["correct", "amend", "add"].includes(review.decision)
    ? issueList(row).filter((issue) => issue.blocking)
    : [];
  if (blocking.length) {
    const panel = document.querySelector(".inspector-panel");
    panel.classList.remove("shake");
    requestAnimationFrame(() => panel.classList.add("shake"));
    showToast(`還有 ${blocking.length} 個必填問題：${blocking.map((item) => item.label).join("、")}`);
    return;
  }
  const index = state.rows.indexOf(row);
  const commitFullName = review.decision !== "delete" && review.fullNameDirty && Boolean((fields.full_name || "").trim());
  const commitResult = review.decision !== "delete" && review.resultDirty && Boolean((fields.result || "").trim());
  savePatch(row, {
    review: {
      done: true,
      flagged: false,
      fullNameDirty: false,
      fullNameEdited: review.fullNameEdited || commitFullName,
      resultDirty: false,
      resultEdited: review.resultEdited || commitResult,
    },
  });
  const propagatedFullNames = commitFullName ? propagateFullName(row, fields.full_name) : 0;
  const propagatedResults = commitResult ? propagateResult(row, fields.result) : 0;
  const next = state.rows.slice(index + 1).find((candidate) => ["pending", "flagged"].includes(rowStatus(candidate)))
    || state.rows.find((candidate) => ["pending", "flagged"].includes(rowStatus(candidate)));
  state.selectedKey = next ? rowKey(next) : rowKey(row);
  saveState();
  render();
  const propagationMessages = [];
  if (commitFullName) {
    propagationMessages.push(propagatedFullNames
      ? `full_name 已套用到後續 ${propagatedFullNames} 筆`
      : "full_name 已儲存；下一個人工修改點維持不變");
  }
  if (commitResult) {
    propagationMessages.push(propagatedResults
      ? `result 已套用到後續 ${propagatedResults} 筆`
      : "result 已儲存；下一個人工修改點維持不變");
  }
  if (propagationMessages.length) showToast(propagationMessages.join("；"));
}

function splitCurrentRow() {
  const row = selectedRow();
  const fields = currentFields(row);
  const id = `new-${Date.now()}`;
  const clone = {
    ...row,
    row_id: id,
    added: true,
    split_after: rowKey(row),
    fields: { ...fields, "序號": `${fields["序號"] || ""}（拆分）` },
  };
  const index = state.rows.indexOf(row);
  state.rows.splice(index + 1, 0, clone);
  state.addedRows.push(clone);
  state.selectedKey = id;
  savePatch(clone, { review: { note: `由 source_row ${row.source_row} 拆分`, done: false } });
  saveState();
  render();
  document.querySelector('[data-field="內容"]').focus();
  showToast("已建立副本，請分別保留各科目的文字與金額");
}

function selectedSourceText() {
  const liveSelection = document.querySelector("#sourceFrame")?.contentWindow?.getSelection()?.toString().trim() || "";
  return liveSelection || state.sourceSelection;
}

function addProposal(content = "") {
  const current = selectedRow();
  const id = `new-${Date.now()}`;
  const fields = Object.fromEntries(state.payload.headers.map((header) => [header, ""]));
  fields["預算年度"] = "115";
  fields["內容"] = content;
  fields.full_name = current ? currentFields(current).full_name : "";
  fields.result = current ? currentFields(current).result : "";
  const row = {
    row_id: id,
    source_row: "",
    start_paragraph: "",
    end_paragraph: "",
    section_context: "由原始議事錄新增",
    suggested_full_name: "",
    added: true,
    split_after: current ? rowKey(current) : "",
    fields,
  };
  const index = current ? state.rows.indexOf(current) + 1 : state.rows.length;
  state.rows.splice(index, 0, row);
  state.addedRows.push(row);
  state.selectedKey = id;
  savePatch(row, { review: { decision: "add", done: false, note: content ? "由原文選取新增" : "新增空白提案" } });
  saveState();
  render();
  const details = document.querySelector(".more-fields");
  details.open = true;
  document.querySelector('[data-field="內容"]').focus();
  showToast(content ? "已用選取的原文建立新提案" : "已建立空白提案");
  state.sourceSelection = "";
}

function bindSourceSelection() {
  const frame = document.querySelector("#sourceFrame");
  const doc = frame.contentDocument;
  if (!doc?.body) return;
  const rememberSelection = () => {
    const selection = frame.contentWindow?.getSelection()?.toString().trim();
    if (selection) state.sourceSelection = selection;
  };
  doc.addEventListener("selectionchange", rememberSelection);
  doc.addEventListener("mouseup", rememberSelection);
  doc.addEventListener("keyup", rememberSelection);
  clearSourceHighlight();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenamePart(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|%]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function filenameDate(value) {
  const match = String(value || "").match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
  if (!match) return filenamePart(value, "unknown-date");
  return `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
}

function exportBaseName() {
  const dataset = state.payload?.dataset || {};
  const row = filenamePart(dataset.source_sheet_row, "review");
  const date = filenameDate(dataset.date);
  const committee = filenamePart(dataset.committee, "unknown-committee");
  const meeting = filenamePart(dataset.meeting_code, "unknown-meeting").replace(/^委員會-/, "");
  return `minutes-review-${row}_${date}_${committee}_${meeting}`;
}

function exportRows() {
  return state.rows.map((row) => ({
    dataset: state.payload.dataset.name,
    row_id: row.row_id,
    source_row: row.source_row,
    added: Boolean(row.added),
    reviewer: state.reviewer,
    review_status: rowStatus(row),
    review_decision: currentReview(row).decision,
    done: currentReview(row).done,
    delete: currentReview(row).decision === "delete",
    flagged: currentReview(row).flagged,
    correction_note: currentReview(row).correction,
    review_note: currentReview(row).note,
    fields: currentFields(row),
  }));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function bindEvents() {
  document.querySelector("#reviewerInput").addEventListener("input", (event) => {
    state.reviewer = event.target.value;
    saveState();
  });
  document.querySelector("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderList();
  });
  for (const button of document.querySelectorAll("#filterTabs button")) {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      for (const item of document.querySelectorAll("#filterTabs button")) item.classList.toggle("active", item === button);
      renderList();
    });
  }
  for (const input of document.querySelectorAll("[data-field]")) {
    const eventName = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => {
      const row = selectedRow();
      if (input.dataset.field === "full_name") setUserFullName(row, input.value);
      else if (input.dataset.field === "result") setUserResult(row, input.value);
      else setField(row, input.dataset.field, input.value);
      if (["cost", "deleted", "frozen"].includes(input.dataset.field)) {
        document.querySelector(`[data-amount-preview="${input.dataset.field}"]`).textContent = formatAmount(input.value);
      }
      renderList();
      renderSummary();
    });
    input.addEventListener("change", () => renderCurrent());
  }
  for (const button of document.querySelectorAll("#actionControl button")) {
    button.addEventListener("click", () => {
      setField(selectedRow(), "action", button.dataset.action);
      render();
    });
  }
  for (const button of document.querySelectorAll("#reviewDecisionControl button")) {
    button.addEventListener("click", () => {
      const row = selectedRow();
      if (row.added) return;
      const decision = button.dataset.decision;
      savePatch(row, { review: { decision, done: false } });
      if (["correct", "amend"].includes(decision)) {
        confirmAndNext();
        return;
      }
      render();
    });
  }
  document.querySelector("#fixCurrentYear").addEventListener("click", () => {
    setField(selectedRow(), "預算年度", "115");
    render();
  });
  document.querySelector("#fixYears").addEventListener("click", () => {
    let count = 0;
    for (const row of state.rows) {
      if (currentReview(row).decision !== "delete" && currentFields(row)["預算年度"] !== "115") {
        setField(row, "預算年度", "115");
        count += 1;
      }
    }
    render();
    showToast(`已將 ${count} 筆預算年度設為 115`);
  });
  document.querySelector("#applyOrganization").addEventListener("click", () => {
    const row = selectedRow();
    if (!row.suggested_full_name) return;
    setUserFullName(row, row.suggested_full_name);
    render();
  });
  document.querySelector("#reviewNote").addEventListener("input", (event) => {
    savePatch(selectedRow(), { review: { note: event.target.value } });
  });
  document.querySelector("#markProblem").addEventListener("click", () => {
    const row = selectedRow();
    savePatch(row, { review: { flagged: !currentReview(row).flagged, done: false } });
    render();
    if (currentReview(row).flagged) move(1);
  });
  document.querySelector("#splitRow").addEventListener("click", splitCurrentRow);
  document.querySelector("#addFromSelection").addEventListener("click", () => {
    const content = selectedSourceText();
    if (!content) {
      showToast("請先在原始議事錄中選取遺漏提案文字");
      return;
    }
    addProposal(content);
  });
  document.querySelector("#addBlankProposal").addEventListener("click", () => addProposal());
  document.querySelector("#locateCurrent").addEventListener("click", () => focusSourceParagraph(selectedRow()));
  document.querySelector("#confirmNext").addEventListener("click", confirmAndNext);
  document.querySelector("#previousRow").addEventListener("click", () => move(-1));
  document.querySelector("#nextRow").addEventListener("click", () => move(1));
  document.querySelector("#downloadJsonl").addEventListener("click", () => {
    download(`${exportBaseName()}.jsonl`, `${exportRows().map((row) => JSON.stringify(row)).join("\n")}\n`, "application/x-ndjson;charset=utf-8");
  });
  document.querySelector("#downloadCsv").addEventListener("click", () => {
    const reviewHeaders = ["row_id", "source_row", "added", "reviewer", "review_status", "review_decision", "done", "delete", "flagged", "correction_note", "review_note"];
    const headers = [...state.payload.headers, ...reviewHeaders];
    const rows = exportRows().map((row) => {
      const flat = { ...row.fields, ...Object.fromEntries(reviewHeaders.map((header) => [header, row[header]])) };
      return headers.map((header) => csvEscape(flat[header])).join(",");
    });
    download(`${exportBaseName()}.csv`, `\ufeff${headers.map(csvEscape).join(",")}\n${rows.join("\n")}\n`, "text/csv;charset=utf-8");
  });
  document.querySelector("#clearDraft").addEventListener("click", () => {
    if (!confirm("清除這場會議在這台電腦上的全部校對草稿？")) return;
    localStorage.removeItem(state.storageKey);
    location.reload();
  });
  const dialog = document.querySelector("#checklistDialog");
  document.querySelector("#checklistButton").addEventListener("click", () => dialog.showModal());
  document.querySelector("#closeChecklist").addEventListener("click", () => dialog.close());
  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft") move(-1);
    if (event.altKey && event.key === "ArrowRight") move(1);
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") confirmAndNext();
  });
}

async function init() {
  const response = await fetch(dataPath);
  if (!response.ok) throw new Error(`資料載入失敗 (${response.status})`);
  state.payload = await response.json();
  state.storageKey = `budget-minutes-review:v6:${state.payload.fingerprint}`;
  const stored = JSON.parse(localStorage.getItem(state.storageKey) || "{}");
  state.edits = stored.edits || {};
  state.addedRows = stored.addedRows || [];
  state.rows = [...state.payload.rows];
  for (const added of state.addedRows) {
    const parentIndex = state.rows.findIndex((row) => rowKey(row) === added.split_after);
    if (parentIndex < 0) {
      state.rows.push(added);
      continue;
    }
    let insertAt = parentIndex + 1;
    while (state.rows[insertAt]?.added && state.rows[insertAt]?.split_after === added.split_after) insertAt += 1;
    state.rows.splice(insertAt, 0, added);
  }
  state.selectedKey = stored.selectedKey || state.rows[0]?.row_id || "";
  state.reviewer = stored.reviewer || "";

  const dataset = state.payload.dataset;
  document.querySelector("#meetingTitle").textContent = dataset.meeting_title || `${dataset.committee}議事錄`;
  document.querySelector("#meetingMeta").textContent = `${dataset.date} · Meeting Sheet 第 ${dataset.source_sheet_row} 列 · ${dataset.row_count} 筆`;
  document.querySelector("#reviewerInput").value = state.reviewer;
  const organizationOptions = document.querySelector("#organizationOptions");
  const organizations = new Set();
  for (const row of state.rows) {
    const fullName = (row.fields.full_name || "").trim();
    if (fullName && fullName !== "立法院") organizations.add(fullName);
    if (row.suggested_full_name) organizations.add(row.suggested_full_name);
  }
  organizationOptions.textContent = "";
  for (const organization of [...organizations].sort((left, right) => left.localeCompare(right, "zh-Hant"))) {
    const option = document.createElement("option");
    option.value = organization;
    organizationOptions.append(option);
  }
  document.querySelector("#minutesLink").href = dataset.minutes_html_file || dataset.source_html || dataset.doc_file || "#";
  document.querySelector("#docLink").href = dataset.doc_file || dataset.ppg_url || "#";
  document.querySelector("#ppgLink").href = dataset.ppg_url || "#";
  const sourceFrame = document.querySelector("#sourceFrame");
  sourceFrame.src = dataset.source_html || dataset.minutes_html_file || dataset.ppg_url || "about:blank";
  sourceFrame.addEventListener("load", bindSourceSelection);
  const checklist = document.querySelector("#checklist");
  for (const item of state.payload.checklist) {
    const li = document.createElement("li");
    li.textContent = item;
    checklist.append(li);
  }

  bindEvents();
  render();
  window.lucide?.createIcons();
}

init().catch((error) => {
  document.querySelector("#meetingMeta").textContent = error.message;
  console.error(error);
});
