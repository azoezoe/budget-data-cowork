const state = {
  datasets: [],
  rows: [],
  edits: {},
  selectedProposalKey: "",
  selectedImageKeys: new Set(),
};

const statusLabels = {
  unchecked: "未校對",
  ok: "ok",
  change_proposal: "改 proposal_ID",
  change_image: "改圖片",
  needs_pairing: "需重新配對",
  skip: "不需匯入",
  unmatched_review: "未配對待查",
};

const storageKey = "budget-gazette-review-edits:v1";
const dataPath = window.BUDGET_REVIEW_DATA || "data/gazette-review.json";
const initialMeeting = window.BUDGET_REVIEW_MEETING || "";

function splitUrls(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("http://") || item.startsWith("https://"));
}

function rowKey(row) {
  return `${row.dataset}::${row.row_id}`;
}

function currentRow(row) {
  return { ...row, ...(state.edits[rowKey(row)] || {}) };
}

function datasetBase(name) {
  return String(name || "").replace(/_(matched|unmatch)$/, "");
}

function isMeetingValue(value) {
  return String(value || "").startsWith("meeting:");
}

function meetingValue(base) {
  return `meeting:${base}`;
}

function selectedBase() {
  const selected = document.querySelector("#datasetFilter").value;
  if (isMeetingValue(selected)) return selected.slice("meeting:".length);
  return datasetBase(selected);
}

function selectedDatasetGroup() {
  const selected = document.querySelector("#datasetFilter").value;
  if (!selected) return state.datasets.map((dataset) => dataset.name);
  const base = selectedBase();
  return state.datasets.filter((dataset) => datasetBase(dataset.name) === base).map((dataset) => dataset.name);
}

function selectedDatasets() {
  const selected = document.querySelector("#datasetFilter").value;
  if (!selected) return state.datasets;
  if (isMeetingValue(selected)) {
    const group = new Set(selectedDatasetGroup());
    return state.datasets.filter((dataset) => group.has(dataset.name));
  }
  return state.datasets.filter((dataset) => dataset.name === selected);
}

function selectedGazetteText() {
  for (const dataset of selectedDatasets()) {
    if (dataset.gazette_text) return dataset.gazette_text;
  }
  return "";
}

function appendNote(row, text) {
  const existing = currentRow(row).note || "";
  return existing ? `${existing}\n${text}` : text;
}

function normalizedLength(value) {
  return String(value || "").replace(/[\W_]+/g, "").length;
}

function hasCaseLabel(value) {
  return /【[^】]*\d[^】]*】/.test(String(value || ""));
}

function splitPreview(value, headLength = 58, tailLength = 42) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= headLength + tailLength + 1) {
    return { head: text, tail: "" };
  }
  return {
    head: `${text.slice(0, headLength)}...`,
    tail: `...${text.slice(-tailLength)}`,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function matchRiskReasons(row) {
  const reasons = [];
  const urls = splitUrls(row.pdf);
  if (!row.dataset.endsWith("_matched") || !urls.length) return reasons;
  if (!row.proposal_ID && hasCaseLabel(row.content)) reasons.push("無 proposal_ID，以括號數字配圖");
  if (normalizedLength(row.content) < 80) reasons.push("文字短");
  if (urls.length > 1) reasons.push(`多圖 ${urls.length} 張`);
  return reasons;
}

function imageCandidateKey(row) {
  return `image:${rowKey(row)}`;
}

function detachedCandidateKey(row, index = 0) {
  return `detached:${rowKey(row)}::${index}`;
}

function saveEdit(row, patch) {
  const key = rowKey(row);
  state.edits[key] = { ...(state.edits[key] || {}), ...patch };
  localStorage.setItem(storageKey, JSON.stringify(state.edits));
  updateSummary();
}

function outputStatus(raw, row) {
  if (row.pair_pool && !splitUrls(row.pdf).length) return "needs_pairing";
  if (row.done) return "ok";
  return row.status || raw.status || "unchecked";
}

function groupRows() {
  const dataset = document.querySelector("#datasetFilter").value;
  const group = new Set(isMeetingValue(dataset) ? selectedDatasetGroup() : []);
  return state.rows.filter((raw) => {
    const row = currentRow(raw);
    if (isMeetingValue(dataset) && !group.has(row.dataset)) return false;
    if (dataset && !isMeetingValue(dataset) && row.dataset !== dataset) return false;
    return true;
  });
}

function isReviewCandidate(raw) {
  const row = currentRow(raw);
  return (
    row.dataset.endsWith("_matched") &&
    splitUrls(row.pdf).length > 0 &&
    !row.paired_from_pool &&
    !row.done &&
    outputStatus(raw, row) !== "ok" &&
    outputStatus(raw, row) !== "skip"
  );
}

function reviewRows() {
  return groupRows().filter(isReviewCandidate);
}

function getFilteredRows(rows = reviewRows()) {
  const status = document.querySelector("#statusFilter").value;
  const query = document.querySelector("#searchInput").value.trim().toLowerCase();
  return rows.filter((raw) => {
    const row = currentRow(raw);
    if (status && outputStatus(raw, row) !== status) return false;
    if (!query) return true;
    return [row.dataset, row.row_id, row.proposal_ID, row.content, (row.pdf || []).join("\n"), row.note]
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
}

function renderImages(container, row, options = {}) {
  container.textContent = "";
  const urls = splitUrls(row.pdf);
  if (!urls.length) {
    const empty = document.createElement("div");
    empty.className = "no-image";
    empty.textContent = "沒有圖片網址";
    container.append(empty);
    return;
  }
  for (const url of urls) {
    const card = document.createElement("div");
    card.className = "image-card";
    const image = document.createElement("img");
    image.src = url;
    image.loading = "lazy";
    image.alt = row.proposal_ID ? `proposal ${row.proposal_ID}` : row.dataset;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = url;
    card.append(image, link);
    if (options.onWrongImage) {
      const actions = document.createElement("div");
      actions.className = "image-card-actions";
      const wrongButton = document.createElement("button");
      wrongButton.type = "button";
      wrongButton.className = "secondary";
      wrongButton.textContent = "這張錯誤，進配對池";
      wrongButton.addEventListener("click", () => options.onWrongImage(url));
      actions.append(wrongButton);
      card.append(actions);
    }
    container.append(card);
  }
}

function renderRows() {
  const rowsNode = document.querySelector("#rows");
  const template = document.querySelector("#rowTemplate");
  rowsNode.textContent = "";
  const pendingRows = reviewRows();
  const rows = getFilteredRows(pendingRows);
  for (const raw of rows) {
    const row = currentRow(raw);
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".dataset").textContent = row.dataset;
    node.querySelector(".row-id").textContent = `#${row.row_id}`;
    const riskTag = node.querySelector(".risk-tag");
    const riskReasons = matchRiskReasons(row);
    riskTag.hidden = !riskReasons.length;
    riskTag.textContent = riskReasons.length ? `高風險：${riskReasons.join("、")}` : "";
    node.querySelector(".proposal-input").value = row.proposal_ID || "";
    node.querySelector(".pdf-input").value = splitUrls(row.pdf).join("\n");
    node.querySelector(".done-input").checked = Boolean(row.done || row.status === "ok");
    node.querySelector(".note-input").value = row.note || "";
    node.querySelector(".content-text").textContent = row.content || "";
    node.querySelector(".wrong-image-button").hidden = !row.dataset.endsWith("_matched") || splitUrls(row.pdf).length < 2;
    renderImages(node.querySelector(".image-pane"), row, {
      onWrongImage: row.dataset.endsWith("_matched") ? (url) => moveWrongImageToPool(raw, url) : null,
    });

    node.querySelector(".proposal-input").addEventListener("input", (event) => {
      saveEdit(raw, { proposal_ID: event.target.value, status: "change_proposal" });
    });
    node.querySelector(".pdf-input").addEventListener("input", (event) => {
      saveEdit(raw, { pdf: splitUrls(event.target.value), status: "change_image" });
      renderImages(node.querySelector(".image-pane"), currentRow(raw), {
        onWrongImage: row.dataset.endsWith("_matched") ? (url) => moveWrongImageToPool(raw, url) : null,
      });
    });
    node.querySelector(".done-input").addEventListener("change", (event) => {
      saveEdit(raw, {
        done: event.target.checked,
        status: event.target.checked ? "ok" : raw.status || "unchecked",
      });
      renderRows();
    });
    node.querySelector(".wrong-image-button").addEventListener("click", () => {
      moveWrongImageToPool(raw);
    });
    node.querySelector(".note-input").addEventListener("input", (event) => {
      saveEdit(raw, { note: event.target.value });
    });
    rowsNode.append(node);
  }
  if (!rows.length) {
    rowsNode.textContent = pendingRows.length ? "沒有符合條件的資料。" : "第一段已完成，請往上方配對池繼續。";
  }
  updateDatasetInfo();
  updateUrlDataset();
  renderPairingPanel();
}

function updateSummary() {
  const pending = reviewRows().length;
  const { missingProposals, unmatchedImages, detachedImages } = matchingRows();
  const imageCount = unmatchedImages.length + detachedImages.reduce((sum, raw) => sum + splitUrls(currentRow(raw).detached_pdf).length, 0);
  document.querySelector("#summary").textContent =
    pending > 0
      ? `第一段待確認 ${pending} 筆；完成後進入配對池`
      : `第一段完成；配對池 ${missingProposals.length} 筆文字、${imageCount} 張圖片`;
}

function updateDatasetInfo() {
  const selected = document.querySelector("#datasetFilter").value;
  const info = document.querySelector("#datasetInfo");
  const textButton = document.querySelector("#openGazetteText");
  if (!selected) {
    info.textContent = "選擇單一會議後，這裡會顯示來源資訊。";
    if (textButton) textButton.disabled = true;
    return;
  }
  const group = selectedDatasets();
  const dataset = group[0];
  if (!dataset) return;
  const rowCount = group.reduce((sum, item) => sum + Number(item.row_count || 0), 0);
  const htmlFiles = [...new Set(group.flatMap((item) => item.html_file || []))];
  if (textButton) textButton.disabled = !selectedGazetteText();
  info.textContent = [
    `來源列號：${dataset.source_sheet_row || ""}`,
    `日期：${dataset.date || ""}`,
    `委員會：${dataset.committee || ""}`,
    `資料列數：${rowCount}`,
    `ppg_url：${dataset.ppg_url || ""}`,
    `html_file：${htmlFiles.join(" ")}`,
  ].join("\n");
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

function safeFilenamePart(value) {
  return String(value || "all")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "all";
}

function exportFilename(extension) {
  const selectedDataset = document.querySelector("#datasetFilter").value;
  const base = selectedDataset ? selectedBase() : "all";
  return `${safeFilenamePart(base)}-review-output.${extension}`;
}

function exportRows() {
  const selectedDataset = document.querySelector("#datasetFilter").value;
  const group = new Set(selectedDataset ? selectedDatasetGroup() : state.datasets.map((dataset) => dataset.name));
  const rows = state.rows.filter((row) => group.has(row.dataset));
  return rows.map((raw) => {
    const row = currentRow(raw);
    return {
      dataset: row.dataset,
      row_id: row.row_id,
      proposal_ID: row.proposal_ID || "",
      pdf: splitUrls(row.pdf),
      status: outputStatus(raw, row),
      done: Boolean(row.done),
      pair_pool: Boolean(row.pair_pool),
      detached_pdf: splitUrls(row.detached_pdf),
      paired_from_pool: Boolean(row.paired_from_pool),
      paired_to_proposal: row.paired_to_proposal || "",
      note: row.note || "",
    };
  });
}

function findRawByKey(key) {
  return state.rows.find((row) => rowKey(row) === key);
}

function toggleSelectedImage(key) {
  if (state.selectedImageKeys.has(key)) {
    state.selectedImageKeys.delete(key);
  } else {
    state.selectedImageKeys.add(key);
  }
}

function imageChoiceCard(key) {
  const card = document.createElement("article");
  card.className = `pair-item image-choice ${state.selectedImageKeys.has(key) ? "selected" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-pressed", state.selectedImageKeys.has(key) ? "true" : "false");
  function toggleFromEvent(event) {
    if (event.target.closest(".gazette-text-button")) return;
    toggleSelectedImage(key);
    renderPairingPanel();
  }
  card.addEventListener("click", toggleFromEvent);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleFromEvent(event);
  });
  return card;
}

function ensureGazetteDrawer() {
  let drawer = document.querySelector("#gazetteTextDrawer");
  if (drawer) return drawer;
  drawer = document.createElement("aside");
  drawer.id = "gazetteTextDrawer";
  drawer.className = "gazette-drawer";
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="gazette-drawer-backdrop" data-close-gazette></div>
    <section class="gazette-drawer-panel" aria-label="公報文字">
      <div class="gazette-drawer-head">
        <h2 id="gazetteDrawerTitle">公報文字</h2>
        <button type="button" class="secondary" data-close-gazette>關閉</button>
      </div>
      <div id="gazetteDrawerText" class="gazette-drawer-text"></div>
    </section>
  `;
  drawer.addEventListener("click", (event) => {
    if (!event.target.closest("[data-close-gazette]")) return;
    closeGazetteDrawer();
  });
  document.body.append(drawer);
  return drawer;
}

function showGazetteDrawer(title, content) {
  const drawer = ensureGazetteDrawer();
  document.querySelector("#gazetteDrawerTitle").textContent = title;
  document.querySelector("#gazetteDrawerText").textContent = content || "沒有公報文字";
  drawer.hidden = false;
  document.body.classList.add("drawer-open");
}

function closeGazetteDrawer() {
  const drawer = document.querySelector("#gazetteTextDrawer");
  if (drawer) drawer.hidden = true;
  document.body.classList.remove("drawer-open");
}

function withdrawProposal(raw) {
  saveEdit(raw, {
    status: "skip",
    done: false,
    note: appendNote(raw, "此案撤案"),
  });
  if (state.selectedProposalKey === rowKey(raw)) {
    state.selectedProposalKey = "";
  }
  renderRows();
}

function matchingRows() {
  const rows = groupRows();
  const detachedImages = rows.filter((raw) => {
    const row = currentRow(raw);
    return row.dataset.endsWith("_matched") && splitUrls(row.detached_pdf).length;
  });
  return {
    missingProposals: rows.filter((raw) => {
      const row = currentRow(raw);
      return row.dataset.endsWith("_matched") && !splitUrls(row.pdf).length && outputStatus(raw, row) !== "skip";
    }),
    pairedProposals: rows.filter((raw) => {
      const row = currentRow(raw);
      return row.dataset.endsWith("_matched") && Boolean(row.paired_from_pool) && splitUrls(row.pdf).length && outputStatus(raw, row) !== "skip";
    }),
    unmatchedImages: rows.filter((raw) => {
      const row = currentRow(raw);
      return (
        row.dataset.endsWith("_unmatch") &&
        splitUrls(row.pdf).length &&
        !row.paired_to_proposal &&
        outputStatus(raw, row) !== "skip"
      );
    }),
    detachedImages,
  };
}

function renderPairingPanel() {
  const panel = document.querySelector("#pairingPanel");
  if (!panel) return;
  const pending = reviewRows().length;
  panel.hidden = pending > 0;
  if (pending > 0) return;

  const { missingProposals, pairedProposals, unmatchedImages, detachedImages } = matchingRows();
  const imageCount = unmatchedImages.length + detachedImages.reduce((sum, raw) => sum + splitUrls(currentRow(raw).detached_pdf).length, 0);
  document.querySelector("#pairingSummary").textContent =
    `${missingProposals.length} 筆文字待配對，${pairedProposals.length} 筆文字已配對，${imageCount} 張圖片待配對`;

  const proposalList = document.querySelector("#missingProposalList");
  const pairedProposalList = document.querySelector("#pairedProposalList");
  const imageList = document.querySelector("#unmatchedImageList");
  proposalList.textContent = "";
  pairedProposalList.textContent = "";
  imageList.textContent = "";

  function appendProposalChoice(raw, container, paired = false) {
    const row = currentRow(raw);
    const key = rowKey(raw);
    const card = document.createElement("article");
    card.className = `pair-item proposal-choice ${state.selectedProposalKey === key ? "selected" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", state.selectedProposalKey === key ? "true" : "false");
    const pdfCount = splitUrls(row.pdf).length;
    const contentPreview = splitPreview(row.content);
    const title = document.createElement("strong");
    title.textContent = paired
      ? `${row.proposal_ID || "(無 proposal_ID)"} 已配 ${pdfCount} 張，可繼續加圖`
      : row.proposal_ID || "(無 proposal_ID)";
    const preview = document.createElement("span");
    preview.className = "pair-preview";
    preview.title = row.content || "";
    const head = document.createElement("span");
    head.textContent = contentPreview.head;
    preview.append(head);
    if (contentPreview.tail) {
      const tail = document.createElement("span");
      tail.className = "pair-preview-tail";
      tail.textContent = contentPreview.tail;
      preview.append(tail);
    }
    card.append(title, preview);
    if (!paired) {
      const withdrawButton = document.createElement("button");
      withdrawButton.type = "button";
      withdrawButton.className = "withdraw-button secondary";
      withdrawButton.textContent = "此案撤案";
      withdrawButton.addEventListener("click", (event) => {
        event.stopPropagation();
        withdrawProposal(raw);
      });
      card.append(withdrawButton);
    }
    function selectProposal(event) {
      if (event.target.closest(".withdraw-button")) return;
      state.selectedProposalKey = key;
      renderPairingPanel();
    }
    card.addEventListener("click", selectProposal);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectProposal(event);
    });
    container.append(card);
  }

  for (const raw of missingProposals) {
    appendProposalChoice(raw, proposalList);
  }

  for (const raw of pairedProposals) {
    appendProposalChoice(raw, pairedProposalList, true);
  }

  for (const raw of unmatchedImages) {
    const row = currentRow(raw);
    const key = imageCandidateKey(raw);
    const card = imageChoiceCard(key);
    const image = document.createElement("img");
    image.src = splitUrls(row.pdf)[0];
    image.loading = "lazy";
    image.alt = "未配對圖片";
    const span = document.createElement("span");
    span.textContent = splitPreview(row.content || splitUrls(row.pdf).join("\n"), 42, 32).head;
    card.append(image, span);
    imageList.append(card);
  }

  for (const raw of detachedImages) {
    const row = currentRow(raw);
    splitUrls(row.detached_pdf).forEach((url, index) => {
      const key = detachedCandidateKey(raw, index);
      const card = imageChoiceCard(key);
      const image = document.createElement("img");
      image.src = url;
      image.loading = "lazy";
      image.alt = "待重新配對圖片";
      const span = document.createElement("span");
      span.textContent = `原本配到 proposal_ID ${row.proposal_ID || ""}\n${url}`;
      card.append(image, span);
      imageList.append(card);
    });
  }

  const applyButton = document.querySelector("#applyPair");
  applyButton.disabled = !state.selectedProposalKey || !state.selectedImageKeys.size;
  applyButton.textContent = state.selectedImageKeys.size
    ? `配對 ${state.selectedImageKeys.size} 張圖片`
    : "配對選取項目";
}

function applySelectedPair() {
  const proposal = findRawByKey(state.selectedProposalKey);
  if (!proposal || !state.selectedImageKeys.size) return;
  const selectedKeys = [...state.selectedImageKeys];
  const selectedItems = selectedKeys
    .map((imageKey) => {
      const isDetached = imageKey.startsWith("detached:");
      const detachedMatch = imageKey.match(/^detached:(.+)::(\d+)$/);
      const sourceKey = isDetached && detachedMatch ? detachedMatch[1] : imageKey.replace(/^image:/, "");
      const imageRow = findRawByKey(sourceKey);
      if (!imageRow) return null;
      const detachedUrls = splitUrls(currentRow(imageRow).detached_pdf);
      const detachedIndex = detachedMatch ? Number(detachedMatch[2]) : 0;
      const imageUrls = isDetached ? detachedUrls.slice(detachedIndex, detachedIndex + 1) : splitUrls(currentRow(imageRow).pdf);
      return { imageKey, isDetached, detachedIndex, imageRow, imageUrls };
    })
    .filter(Boolean);
  if (!selectedItems.length) return;
  const currentProposal = currentRow(proposal);
  const nextImageUrls = [...new Set([...splitUrls(currentProposal.pdf), ...selectedItems.flatMap((item) => item.imageUrls)])];
  const proposalId = currentRow(proposal).proposal_ID || "";
  const pairNote = document.querySelector("#pairNoteInput")?.value.trim() || "";
  const sourceNote = `配對圖片來源：${selectedItems.map((item) => `${item.imageRow.dataset} #${item.imageRow.row_id}`).join("、")}`;
  const reviewerNote = pairNote ? `配對註解：${pairNote}` : "";
  saveEdit(proposal, {
    pdf: nextImageUrls,
    status: "change_image",
    done: false,
    pair_pool: false,
    paired_from_pool: true,
    note: appendNote(proposal, [sourceNote, reviewerNote].filter(Boolean).join("\n")),
  });
  const detachedIndexesByRow = new Map();
  for (const item of selectedItems) {
    if (item.isDetached) {
      const key = rowKey(item.imageRow);
      if (!detachedIndexesByRow.has(key)) detachedIndexesByRow.set(key, { row: item.imageRow, indexes: new Set() });
      detachedIndexesByRow.get(key).indexes.add(item.detachedIndex);
    } else {
      saveEdit(item.imageRow, {
        paired_to_proposal: state.selectedProposalKey,
        status: "skip",
        note: appendNote(item.imageRow, [`已配對到 proposal_ID ${proposalId}：${proposal.dataset} #${proposal.row_id}`, reviewerNote].filter(Boolean).join("\n")),
      });
    }
  }
  for (const { row, indexes } of detachedIndexesByRow.values()) {
    const detachedUrls = splitUrls(currentRow(row).detached_pdf);
    const remainingDetached = detachedUrls.filter((_, index) => !indexes.has(index));
    saveEdit(row, {
      detached_pdf: remainingDetached,
      detached_used: remainingDetached.length === 0,
      note: appendNote(row, [`原錯配圖片已配對到 proposal_ID ${proposalId}：${proposal.dataset} #${proposal.row_id}`, reviewerNote].filter(Boolean).join("\n")),
    });
  }
  state.selectedImageKeys.clear();
  const noteInput = document.querySelector("#pairNoteInput");
  if (noteInput) noteInput.value = "";
  renderRows();
}

function moveWrongImageToPool(raw, wrongUrl = null) {
  const row = currentRow(raw);
  const urls = splitUrls(row.pdf);
  if (!urls.length) return;
  const wrongUrls = wrongUrl ? urls.filter((url) => url === wrongUrl) : urls;
  if (!wrongUrls.length) return;
  const keptUrls = wrongUrl ? urls.filter((url) => url !== wrongUrl) : [];
  const detachedUrls = [...splitUrls(row.detached_pdf), ...wrongUrls];
  saveEdit(raw, {
    pdf: keptUrls,
    detached_pdf: detachedUrls,
    detached_used: false,
    pair_pool: keptUrls.length === 0,
    done: false,
    status: "change_image",
    note: appendNote(raw, wrongUrl ? `圖片錯誤，已移入配對池：${wrongUrl}` : "圖片錯誤，已移入配對池"),
  });
  renderRows();
}

function updateUrlDataset() {
  const selectedDataset = document.querySelector("#datasetFilter").value;
  const url = new URL(window.location.href);
  if (isMeetingValue(selectedDataset) && initialMeeting && selectedBase() === initialMeeting) {
    url.searchParams.delete("meeting");
    url.searchParams.delete("dataset");
  } else if (isMeetingValue(selectedDataset)) {
    url.searchParams.set("meeting", selectedBase());
    url.searchParams.delete("dataset");
  } else if (selectedDataset) {
    url.searchParams.set("dataset", selectedDataset);
    url.searchParams.delete("meeting");
  } else {
    url.searchParams.delete("dataset");
    url.searchParams.delete("meeting");
  }
  window.history.replaceState({}, "", url);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function init() {
  ensureGazetteDrawer();
  const response = await fetch(dataPath);
  const payload = await response.json();
  if (initialMeeting) {
    const meetingDatasets = new Set(
      payload.datasets
        .filter((dataset) => datasetBase(dataset.name) === initialMeeting)
        .map((dataset) => dataset.name),
    );
    state.datasets = payload.datasets.filter((dataset) => meetingDatasets.has(dataset.name));
    state.rows = payload.rows.filter((row) => meetingDatasets.has(row.dataset));
  } else {
    state.datasets = payload.datasets;
    state.rows = payload.rows;
  }
  state.edits = JSON.parse(localStorage.getItem(storageKey) || "{}");

  const datasetFilter = document.querySelector("#datasetFilter");
  const bases = [...new Set(state.datasets.map((dataset) => datasetBase(dataset.name)))];
  if (!initialMeeting) {
    datasetFilter.append(new Option("全部", ""));
  }
  for (const base of bases) {
    const group = state.datasets.filter((dataset) => datasetBase(dataset.name) === base);
    const first = group[0];
    const rowCount = group.reduce((sum, dataset) => sum + Number(dataset.row_count || 0), 0);
    datasetFilter.append(
      new Option(`${first.date} ${first.committee} ${base} (${rowCount})`, meetingValue(base)),
    );
  }
  if (!initialMeeting) {
    for (const dataset of state.datasets) {
      datasetFilter.append(new Option(`${dataset.name} (${dataset.row_count})`, dataset.name));
    }
  }
  const params = new URLSearchParams(window.location.search);
  const requestedMeeting = params.get("meeting") || initialMeeting;
  const requestedDataset = params.get("dataset");
  if (!initialMeeting && requestedDataset && state.datasets.some((dataset) => dataset.name === requestedDataset)) {
    datasetFilter.value = requestedDataset;
  } else if (requestedMeeting && bases.includes(requestedMeeting)) {
    datasetFilter.value = meetingValue(requestedMeeting);
  } else if (state.datasets.length) {
    datasetFilter.value = meetingValue(datasetBase(state.datasets[0].name));
  }

  if (initialMeeting) {
    datasetFilter.disabled = true;
    datasetFilter.closest("label").hidden = true;
  }

  for (const selector of ["#datasetFilter", "#statusFilter", "#searchInput"]) {
    document.querySelector(selector).addEventListener("input", renderRows);
  }
  document.querySelector("#applyPair").addEventListener("click", applySelectedPair);
  const openGazetteTextButton = document.querySelector("#openGazetteText");
  if (openGazetteTextButton) {
    openGazetteTextButton.addEventListener("click", () => {
      showGazetteDrawer("整份公報文字", selectedGazetteText());
    });
  }
  document.querySelector("#downloadJsonl").addEventListener("click", () => {
    download(
      exportFilename("jsonl"),
      exportRows().map((row) => JSON.stringify(row)).join("\n") + "\n",
      "application/x-ndjson;charset=utf-8",
    );
  });
  document.querySelector("#downloadCsv").addEventListener("click", () => {
    const headers = ["dataset", "row_id", "proposal_ID", "pdf", "status", "done", "pair_pool", "detached_pdf", "paired_from_pool", "paired_to_proposal", "note"];
    const rows = exportRows().map((row) => headers.map((header) => csvEscape(row[header])).join(","));
    download(exportFilename("csv"), `${headers.join(",")}\n${rows.join("\n")}\n`, "text/csv;charset=utf-8");
  });
  document.querySelector("#clearDraft").addEventListener("click", () => {
    if (!confirm("清除這台電腦上的草稿？")) return;
    state.edits = {};
    localStorage.removeItem(storageKey);
    renderRows();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeGazetteDrawer();
  });

  updateSummary();
  renderRows();
}

init().catch((error) => {
  document.querySelector("#summary").textContent = `載入失敗：${error.message}`;
});
