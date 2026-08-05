const state = {
  datasets: [],
  rows: [],
  edits: {},
};

const statusLabels = {
  unchecked: "未校對",
  ok: "ok",
  change_proposal: "改 proposal_ID",
  change_image: "改圖片",
  skip: "不需匯入",
  unmatched_review: "未配對待查",
};

const storageKey = "budget-gazette-review-edits:v1";

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

function saveEdit(row, patch) {
  const key = rowKey(row);
  state.edits[key] = { ...(state.edits[key] || {}), ...patch };
  localStorage.setItem(storageKey, JSON.stringify(state.edits));
  updateSummary();
}

function getFilteredRows() {
  const dataset = document.querySelector("#datasetFilter").value;
  const status = document.querySelector("#statusFilter").value;
  const query = document.querySelector("#searchInput").value.trim().toLowerCase();
  return state.rows.filter((raw) => {
    const row = currentRow(raw);
    if (dataset && row.dataset !== dataset) return false;
    if (status && row.status !== status) return false;
    if (!query) return true;
    return [row.dataset, row.row_id, row.proposal_ID, row.content, (row.pdf || []).join("\n"), row.note]
      .join("\n")
      .toLowerCase()
      .includes(query);
  });
}

function renderImages(container, row) {
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
    container.append(card);
  }
}

function renderRows() {
  const rowsNode = document.querySelector("#rows");
  const template = document.querySelector("#rowTemplate");
  rowsNode.textContent = "";
  const rows = getFilteredRows();
  for (const raw of rows) {
    const row = currentRow(raw);
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".dataset").textContent = row.dataset;
    node.querySelector(".row-id").textContent = `#${row.row_id}`;
    node.querySelector(".proposal-input").value = row.proposal_ID || "";
    node.querySelector(".pdf-input").value = splitUrls(row.pdf).join("\n");
    node.querySelector(".status-input").value = row.status || "unchecked";
    node.querySelector(".note-input").value = row.note || "";
    node.querySelector(".content-text").textContent = row.content || "";
    renderImages(node.querySelector(".image-pane"), row);

    node.querySelector(".proposal-input").addEventListener("input", (event) => {
      saveEdit(raw, { proposal_ID: event.target.value });
    });
    node.querySelector(".pdf-input").addEventListener("input", (event) => {
      saveEdit(raw, { pdf: splitUrls(event.target.value) });
      renderImages(node.querySelector(".image-pane"), currentRow(raw));
    });
    node.querySelector(".status-input").addEventListener("change", (event) => {
      saveEdit(raw, { status: event.target.value });
    });
    node.querySelector(".note-input").addEventListener("input", (event) => {
      saveEdit(raw, { note: event.target.value });
    });
    rowsNode.append(node);
  }
  if (!rows.length) {
    rowsNode.textContent = "沒有符合條件的資料。";
  }
  updateDatasetInfo();
}

function updateSummary() {
  const total = state.rows.length;
  const reviewed = state.rows.filter((row) => currentRow(row).status !== "unchecked").length;
  document.querySelector("#summary").textContent = `${state.datasets.length} 個資料集，${total} 筆，已標狀態 ${reviewed} 筆`;
}

function updateDatasetInfo() {
  const selected = document.querySelector("#datasetFilter").value;
  const info = document.querySelector("#datasetInfo");
  if (!selected) {
    info.textContent = "選擇單一會議後，這裡會顯示來源資訊。";
    return;
  }
  const dataset = state.datasets.find((item) => item.name === selected);
  if (!dataset) return;
  info.textContent = [
    `來源列號：${dataset.source_sheet_row || ""}`,
    `日期：${dataset.date || ""}`,
    `委員會：${dataset.committee || ""}`,
    `資料列數：${dataset.row_count}`,
    `ppg_url：${dataset.ppg_url || ""}`,
    `html_file：${(dataset.html_file || []).join(" ")}`,
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

function exportRows() {
  return state.rows.map((raw) => {
    const row = currentRow(raw);
    return {
      dataset: row.dataset,
      row_id: row.row_id,
      proposal_ID: row.proposal_ID || "",
      pdf: splitUrls(row.pdf),
      status: row.status || "unchecked",
      note: row.note || "",
    };
  });
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function init() {
  const response = await fetch("data/gazette-review.json");
  const payload = await response.json();
  state.datasets = payload.datasets;
  state.rows = payload.rows;
  state.edits = JSON.parse(localStorage.getItem(storageKey) || "{}");

  const datasetFilter = document.querySelector("#datasetFilter");
  datasetFilter.append(new Option("全部", ""));
  for (const dataset of state.datasets) {
    datasetFilter.append(new Option(`${dataset.name} (${dataset.row_count})`, dataset.name));
  }
  if (state.datasets.length) {
    datasetFilter.value = state.datasets[0].name;
  }

  for (const selector of ["#datasetFilter", "#statusFilter", "#searchInput"]) {
    document.querySelector(selector).addEventListener("input", renderRows);
  }
  document.querySelector("#downloadJsonl").addEventListener("click", () => {
    download(
      "review-output.jsonl",
      exportRows().map((row) => JSON.stringify(row)).join("\n") + "\n",
      "application/x-ndjson;charset=utf-8",
    );
  });
  document.querySelector("#downloadCsv").addEventListener("click", () => {
    const headers = ["dataset", "row_id", "proposal_ID", "pdf", "status", "note"];
    const rows = exportRows().map((row) => headers.map((header) => csvEscape(row[header])).join(","));
    download("review-output.csv", `${headers.join(",")}\n${rows.join("\n")}\n`, "text/csv;charset=utf-8");
  });
  document.querySelector("#clearDraft").addEventListener("click", () => {
    if (!confirm("清除這台電腦上的草稿？")) return;
    state.edits = {};
    localStorage.removeItem(storageKey);
    renderRows();
  });

  updateSummary();
  renderRows();
}

init().catch((error) => {
  document.querySelector("#summary").textContent = `載入失敗：${error.message}`;
});
