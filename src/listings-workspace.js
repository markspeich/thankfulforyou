import { fetchListingCopyPrompt, saveListingCopyPrompt, fetchListings, importEtsyListing, runListingAction, saveListingDraft } from "./listings-api.js";
import { runAuthenticatedRequest } from "./authenticated-request.js";

const EMPTY_BULLETS = Object.freeze(["", "", "", "", ""]);
const editableKeys = ["title", "description", "bullets", "basePriceCents", "copyApproved", "images", "amazonProductionDetails"];
const sandboxStatuses = new Set(["checked", "invalid", "accepted", "unknown", "failed", "unconfirmed", "running", "inactive", "buyable"]);
const productionDetailNumericKeys = ["packageLengthInches", "packageWidthInches", "packageHeightInches", "packageWeightOunces"];
const productionDetailStringKeys = ["manufacturer", "partNumber", "specialFeature", "closureType"];

function normalizeProductionDetailNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : String(value);
}

function normalizeProductionDetails(value = {}) {
  const details = value && typeof value === "object" ? value : {};
  return {
    ...Object.fromEntries(productionDetailNumericKeys.map((key) => [key, normalizeProductionDetailNumber(details[key])])),
    ...Object.fromEntries(productionDetailStringKeys.map((key) => [key, String(details[key] ?? "").trim()])),
  };
}

function productionDetailIssues(details) {
  const normalized = normalizeProductionDetails(details);
  return {
    ...Object.fromEntries(productionDetailNumericKeys.filter((key) => !Number.isFinite(Number(normalized[key])) || Number(normalized[key]) <= 0).map((key) => [key, "Enter a positive number."])),
    ...Object.fromEntries(productionDetailStringKeys.filter((key) => !normalized[key] || normalized[key].length > 200).map((key) => [key, normalized[key] ? "Use 200 characters or fewer." : "This field is required."])),
  };
}

function normalizeSandbox(value = {}) {
  return {
    sku: String(value.sku || ""),
    notice: String(value.notice || ""),
    localIssues: Array.isArray(value.localIssues) ? value.localIssues.map(String) : [],
    attempts: Array.isArray(value.attempts) ? value.attempts.filter((attempt) => attempt && typeof attempt === "object").map((attempt) => ({ id: String(attempt.id || ""), revision: Number(attempt.revision || 0), action: String(attempt.action || ""), status: sandboxStatuses.has(attempt.status) ? attempt.status : "unknown", issues: Array.isArray(attempt.issues) ? attempt.issues.map((issue) => typeof issue === "object" && issue ? { code: String(issue.code || ""), severity: String(issue.severity || ""), message: String(issue.message || ""), attributeNames: Array.isArray(issue.attributeNames) ? issue.attributeNames.map(String) : [] } : { code: "", severity: "", message: String(issue || "") }) : [], createdAt: String(attempt.createdAt || "") })) : [],
  };
}

export function normalizeListingDraft(value = {}) {
  return {
    id: String(value.id || ""), revision: Number(value.revision || 0), etsyListingId: value.etsyListingId || "", sourceUrl: value.sourceUrl || "", sourceTitle: value.sourceTitle || "", sourceDescription: value.sourceDescription || "",
    title: value.title || "", description: value.description || "", bullets: [...EMPTY_BULLETS].map((blank, index) => String(value.bullets?.[index] || blank)), basePriceCents: Number.isFinite(Number(value.basePriceCents)) ? Number(value.basePriceCents) : 1999,
    facts: value.facts && typeof value.facts === "object" ? value.facts : {}, warnings: Array.isArray(value.warnings) ? value.warnings : [], copyApproved: Boolean(value.copyApproved), amazonSandbox: normalizeSandbox(value.amazonSandbox), amazonProduction: normalizeSandbox(value.amazonProduction), amazonProductionDetails: normalizeProductionDetails(value.amazonProductionDetails),
    images: Array.isArray(value.images) ? value.images.filter((image) => image?.id).map((image) => ({ id: String(image.id), url: image.url || "", sourceUrl: image.sourceUrl || "", kind: image.kind || "original", alt: image.alt || "", selected: Boolean(image.selected), main: Boolean(image.main), approved: Boolean(image.approved) })) : [],
  };
}

export function applyDraftChanges(draft, change) {
  const next = normalizeListingDraft(draft);
  if (change?.imageId) {
    next.images = next.images.map((image) => {
      if (change.main) return { ...image, selected: image.id === change.imageId ? true : image.selected, main: image.id === change.imageId, approved: image.id === change.imageId ? false : image.approved };
      return image.id === change.imageId ? { ...image, ...Object.fromEntries(["selected", "approved"].filter((key) => key in change).map((key) => [key, Boolean(change[key])])), main: change.selected === false ? false : image.main, approved: "selected" in change ? false : Boolean(change.approved ?? image.approved) } : image;
    });
    return { ...next, _saved: draft._saved };
  }
  return { ...normalizeListingDraft({ ...next, ...change, ...(["title", "description", "bullets", "basePriceCents"].some((key) => key in change) ? { copyApproved: false } : {}) }), _saved: draft._saved };
}

export function mergeUploadedDraft(local, uploaded) {
  const saved = normalizeListingDraft(uploaded);
  const changes = getChanges(local);
  const { images: ignoredImages, ...copyChanges } = changes;
  const localMainChanged = local.images.some(image => image.main !== local._saved?.images.find(before => before.id === image.id)?.main);
  const images = saved.images.map(image => {
    const edited = local.images.find(candidate => candidate.id === image.id);
    const before = local._saved?.images.find(candidate => candidate.id === image.id);
    if (!edited || !before) return localMainChanged ? { ...image, main: false } : image;
    const edits = Object.fromEntries(["selected", "main", "approved"].filter(key => edited[key] !== before[key]).map(key => [key, edited[key]]));
    return { ...image, ...edits };
  });
  return { ...saved, ...copyChanges, images, _saved: saved };
}

function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function getChanges(draft) { return Object.fromEntries(editableKeys.filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(draft._saved?.[key])).map((key) => [key, draft[key]])); }
function localReadiness(draft, { includeProductionDetails = false } = {}) {
  const issues = [...draft.amazonSandbox.localIssues];
  if (!draft.title.trim()) issues.push("Title is required.");
  if (!draft.description.trim()) issues.push("Description is required.");
  if (draft.bullets.some((bullet) => !bullet.trim())) issues.push("Five nonempty bullets are required.");
  if (!draft.copyApproved) issues.push("Copy must be approved.");
  const selected = draft.images.filter((image) => image.selected);
  if (!selected.some((image) => image.main && image.approved)) issues.push("One selected approved main image is required.");
  if (selected.some((image) => !image.approved)) issues.push("Every selected image must be approved.");
  if (includeProductionDetails) issues.push(...Object.entries(productionDetailIssues(draft.amazonProductionDetails)).map(([key, message]) => `${productionDetailLabel(key)}: ${message}`));
  return [...new Set(issues)];
}
function productionDetailLabel(key) {
  return ({ packageLengthInches: "Package length", packageWidthInches: "Package width", packageHeightInches: "Package height", packageWeightOunces: "Package weight", manufacturer: "Manufacturer", partNumber: "Part number", specialFeature: "Special feature", closureType: "Closure type" })[key] || key;
}
function sandboxState(draft) {
  const attempts = draft.amazonSandbox.attempts;
  const current = attempts.filter((attempt) => attempt.revision === draft.revision);
  const validations = current.filter((attempt) => attempt.action === "validate");
  const latestValidation = validations.reduce((latest, attempt) => !latest || String(attempt.createdAt) >= String(latest.createdAt) ? attempt : latest, null);
  return {
    attempts,
    previewReady: Boolean(latestValidation?.status === "checked"),
    pendingSubmission: current.some((attempt) => attempt.action === "submit" && ["unknown", "unconfirmed", "accepted", "running"].includes(attempt.status)),
    unknownSubmission: attempts.some((attempt) => attempt.action === "submit" && ["unknown", "unconfirmed"].includes(attempt.status)),
    needsReconcile: attempts.some((attempt) => attempt.action === "submit" && ["unknown", "unconfirmed"].includes(attempt.status)),
  };
}

export function createListingsWorkspace({ root, getAccessToken, onAccessToken, onAuthenticationRequired = () => {}, onSelect = () => {} }) {
  let drafts = []; let selectedId = null; let hasLoaded = false; let capabilities = { amazon: false, amazonSandbox: false, copyGeneration: false, imagePreparation: false }; let loading = false; let error = ""; let priceError = ""; let priceInput = null; let importInput = ""; let refreshedToken = null; let epoch = 0; let errorDialog = null; let confirmation = null; let promptEditor = null; let resultDialog = null; const revealedAmazonDrafts = new Set(); const validationDrafts = new Set(); let workingMessage = "Updating listing...";
  const token = () => refreshedToken || getAccessToken?.() || null;
  const saveSnapshot = (draft) => ({ ...normalizeListingDraft(draft), _saved: normalizeListingDraft(draft) });
  const selected = () => drafts.find((draft) => draft.id === selectedId) || null;
  const dialogFocusSelector = () => {
    const target = document.activeElement;
    if (target?.dataset?.action) return `[data-action="${target.dataset.action}"]`;
    if (target?.dataset?.prepareImage) return `[data-prepare-image="${target.dataset.prepareImage}"]`;
    if (target?.dataset?.field) return `[data-field="${target.dataset.field}"]`;
    return null;
  };
  const dismissErrorDialog = () => {
    const focusSelector = errorDialog?.focusSelector;
    errorDialog = null;
    render();
    if (focusSelector) queueMicrotask(() => root.querySelector(focusSelector)?.focus());
  };
  const showErrorDialog = (message, focusSelector = dialogFocusSelector()) => { errorDialog = { message, focusSelector }; };
  const confirmAction = (title, message, label) => new Promise((resolve) => {
    if (confirmation) { resolve(false); return; }
    confirmation = { title, message, label, resolve, focusSelector: dialogFocusSelector() };
    render();
  });
  const finishConfirmation = (accepted) => {
    const pending = confirmation;
    if (!pending) return;
    confirmation = null;
    render();
    if (pending.focusSelector) root.querySelector(pending.focusSelector)?.focus();
    pending.resolve(accepted);
  };
  const renderSandbox = (draft, dirty) => {
    if (!capabilities.amazonSandbox) return "";
    const readiness = localReadiness(draft); const state = sandboxState(draft);
    const attempts = state.attempts.map((attempt) => `<li class="amazon-sandbox-attempt ${attempt.revision === draft.revision ? "" : "is-stale"}"><strong>${escapeHtml(attempt.action)}</strong> <span>${escapeHtml(attempt.status)}</span><span>Revision ${escapeHtml(attempt.revision)}${attempt.revision === draft.revision ? "" : " — not current"}</span>${attempt.createdAt ? `<time>${escapeHtml(attempt.createdAt)}</time>` : ""}${attempt.issues.length ? `<ul>${attempt.issues.map((issue) => `<li>${escapeHtml([issue.code, issue.severity, issue.message].filter(Boolean).join(": "))}</li>`).join("")}</ul>` : ""}</li>`).join("") || "<li>No sandbox attempts yet.</li>";
    const submitDisabled = dirty || readiness.length > 0 || !state.previewReady || state.pendingSubmission || state.unknownSubmission;
    return `<section class="amazon-sandbox-card"><header><div><p class="eyebrow">Protocol test only</p><h3>Amazon sandbox</h3></div><span class="amazon-sandbox-disabled">Sandbox only</span></header><p>${escapeHtml(draft.amazonSandbox.notice || "Canned sandbox responses only. No production listing is created.")}</p>${draft.amazonSandbox.sku ? `<p class="amazon-sandbox-sku">Sandbox SKU: ${escapeHtml(draft.amazonSandbox.sku)}</p>` : ""}<div><h4>Local readiness</h4>${readiness.length ? `<ul class="amazon-sandbox-issues">${readiness.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : "<p class=\"amazon-sandbox-ready\">Ready for sandbox testing.</p>"}</div>${state.needsReconcile ? "<p class=\"amazon-sandbox-warning\">The previous submission is unknown. Check sandbox status before attempting another submission.</p>" : ""}<div class="amazon-sandbox-actions"><button type="button" data-action="sandbox-preview" ${dirty ? "disabled" : ""}>Run sandbox preview</button><button type="button" data-action="sandbox-submit" ${submitDisabled ? "disabled" : ""}>Test sandbox submission</button><button type="button" data-action="sandbox-status" ${dirty || !state.needsReconcile ? "disabled" : ""}>Check sandbox status</button></div><div><h4>Sandbox attempt history</h4><ul class="amazon-sandbox-history">${attempts}</ul></div></section>`;
  };
  const productionState = draft => {
    const attempts = draft.amazonProduction.attempts;
    const latest = attempts.filter(a => a.action === "validate" && a.revision === draft.revision).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
    const submitted = attempts.some(a => a.action === "submit" && ["accepted", "unknown", "unconfirmed", "inactive", "buyable", "running"].includes(a.status));
    const issues = localReadiness({ ...draft, amazonSandbox: draft.amazonProduction }, { includeProductionDetails: true });
    if (draft.images.filter(image => image.selected).length > 9) issues.push("Select no more than nine images.");
    return { attempts, submitted, canSubmit: latest?.status === "checked" && !submitted && !issues.length, issues };
  };
  const renderProduction = (draft, dirty) => {
    if (!capabilities.amazonProduction) return "";
    const state = productionState(draft);
    const details = draft.amazonProductionDetails;
    const detailIssues = productionDetailIssues(details);
    const detailField = (key, label, suffix = "") => `<label>${escapeHtml(label)}<input data-production-detail="${key}" value="${escapeHtml(details[key])}" ${productionDetailStringKeys.includes(key) ? 'maxlength="200"' : 'inputmode="decimal"'} aria-describedby="production-detail-error-${key}" />${detailIssues[key] ? `<span id="production-detail-error-${key}" class="production-detail-error" hidden>${escapeHtml(detailIssues[key])}</span>` : `<span id="production-detail-error-${key}" class="production-detail-error" hidden></span>`}${suffix}</label>`;
    return `<section class="amazon-sandbox-card amazon-production-card"><header><h3>Amazon production</h3></header><p>${escapeHtml(draft.amazonProduction.notice || "Create a product-only listing without price, inventory, or sales terms. Review its status in Seller Central before offering it for sale.")}</p><p>SKU: ${escapeHtml(draft.amazonProduction.sku)}</p><section class="production-details-card" aria-labelledby="production-details-title"><div><h4 id="production-details-title">Amazon production details</h4><p>Confirm the packaged product facts for this listing before validation.</p></div><div class="production-details-grid">${detailField("packageLengthInches", "Package length (in)")}${detailField("packageWidthInches", "Package width (in)")}${detailField("packageHeightInches", "Package height (in)")}${detailField("packageWeightOunces", "Package weight (oz)")}${detailField("manufacturer", "Manufacturer")}${detailField("partNumber", "Part number")}${detailField("specialFeature", "Special feature")}${detailField("closureType", "Closure type")}</div></section>${state.issues.length ? `<ul class="amazon-sandbox-issues">${state.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : ""}<div class="amazon-sandbox-actions"><button type="button" data-action="production-validate" ${dirty ? "disabled" : ""}>Validate with Amazon</button><button type="button" data-action="production-submit" ${dirty || !state.canSubmit ? "disabled" : ""}>Create inactive Amazon listing</button><button type="button" data-action="production-status" ${dirty || !state.submitted ? "disabled" : ""}>Check Amazon status</button></div><h4>Production attempt history</h4><ul class="amazon-sandbox-history">${state.attempts.map(attempt => `<li class="amazon-sandbox-attempt"><strong>${escapeHtml(attempt.action)}</strong><span>${escapeHtml(attempt.status)}</span><span>Revision ${attempt.revision}${attempt.revision !== draft.revision ? " — not current" : ""}</span>${attempt.issues.map(issue => `<p class="${issue.severity.toUpperCase() === "ERROR" ? "amazon-sandbox-issues" : ""}">${escapeHtml(issue.message)}</p>`).join("")}</li>`).join("") || "<li>No production attempts yet.</li>"}</ul></section>`;
  };
  function updateValidation() {
    const draft = selected();
    if (!draft) return;
    const active = validationDrafts.has(draft.id);
    const mark = (node, invalid) => { if (!node) return; node.classList.toggle("listing-invalid", active && invalid); if (active && invalid) node.setAttribute("aria-invalid", "true"); else node.removeAttribute("aria-invalid"); };
    mark(root.querySelector('[data-field="title"]'), !draft.title.trim());
    mark(root.querySelector('[data-field="description"]'), !draft.description.trim());
    root.querySelectorAll('[data-bullet]').forEach(node => mark(node, !draft.bullets[Number(node.dataset.bullet)]?.trim()));
    mark(root.querySelector('[data-copy-approved]'), !draft.copyApproved);
    const detailIssues = productionDetailIssues(draft.amazonProductionDetails);
    for (const key of [...productionDetailNumericKeys, ...productionDetailStringKeys]) {
      const field = root.querySelector(`[data-production-detail="${key}"]`);
      mark(field, Boolean(detailIssues[key]));
      const detailError = root.querySelector(`#production-detail-error-${key}`);
      if (detailError) { detailError.hidden = !(active && detailIssues[key]); detailError.textContent = active && detailIssues[key] ? detailIssues[key] : ""; }
    }
    const remote = draft.amazonProduction.attempts.filter(a => a.revision === draft.revision).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!isDirty(draft)) for (const issue of remote?.issues || []) {
      if (issue.severity.toUpperCase() !== "ERROR") continue;
      for (const name of issue.attributeNames || []) {
        const selector = name === "item_name" ? '[data-field="title"]' : name === "product_description" ? '[data-field="description"]' : name === "bullet_point" ? '[data-bullet]' : /image/.test(name) ? '.listings-gallery' : null;
        if (selector) root.querySelectorAll(selector).forEach(node => mark(node, true));
      }
    }
    const included = draft.images.filter(image => image.selected);
    const invalidMain = included.filter(image => image.main).length !== 1;
    mark(root.querySelector('.listings-gallery'), included.length > 9 || invalidMain || (!isDirty(draft) && (remote?.issues || []).some(issue => issue.severity.toUpperCase() === "ERROR" && issue.attributeNames?.some(name => /image/.test(name)))));
    root.querySelectorAll('[data-image-select]').forEach(node => {
      const image = draft.images.find(image => image.id === node.dataset.imageSelect);
      const card = node.closest('.listings-image');
      mark(card, image.selected && (!image.approved || !/^https?:\/\//i.test(image.url) || included.length > 9 || invalidMain));
      mark(card.querySelector('[data-image-approved]'), image.selected && !image.approved);
      mark(card.querySelector('[data-image-main]'), image.selected && invalidMain);
      card.querySelector('[data-image-approved]').disabled = loading || !image.selected;
      card.querySelector('[data-image-main]').disabled = loading || !image.selected;
    });
  }
  const render = () => {
    const draft = selected(); const dirty = isDirty(draft);
    const sandboxCard = draft ? renderSandbox(draft, dirty) : "";
    root.innerHTML = `<section class="listings-workspace"><aside class="listings-library"><header><h1>Listings</h1><p>Prepare Etsy listings while Amazon access is pending.</p></header><form data-action="import"><label>Etsy listing URL or ID<input name="source" value="${escapeHtml(importInput)}" required placeholder="https://www.etsy.com/listing/..." /></label><button class="batch-primary-action" ${loading ? "disabled" : ""}>Import Etsy listing</button></form><div class="listings-draft-list">${loading && !drafts.length ? "<p>Loading drafts…</p>" : drafts.map((item) => `<button type="button" data-select="${escapeHtml(item.id)}" class="listings-draft-row ${item.id === selectedId ? "is-selected" : ""}"><strong>${escapeHtml(item.title || item.sourceTitle || "Untitled listing")}</strong><span>${escapeHtml(item.etsyListingId || "Draft")}</span></button>`).join("") || "<p>No saved drafts yet.</p>"}</div></aside><section class="listings-editor">${!draft ? "<div class=\"listings-empty\"><h2>Select or import an Etsy listing</h2><p>Amazon submission is unavailable until account access and schema validation are complete. Drafts retain manual edits and image review.</p></div>" : `<header class="listings-editor-header"><div><p class="eyebrow">Etsy to Amazon preparation</p><h2>${escapeHtml(draft.sourceTitle || draft.title || "Listing draft")}</h2><p>${dirty ? "Unsaved changes" : "Saved draft"}</p></div><button type="button" data-action="save" class="batch-primary-action" ${!dirty || loading || priceError ? "disabled" : ""}>Save draft</button></header><p class="listings-status" role="status">${escapeHtml(error || priceError || (capabilities.amazon ? "Amazon connection available for a later review step." : "Amazon submission is unavailable until account access and schema validation are complete."))}</p><div class="listings-editor-body"><section class="listings-copy-card"><h3>Listing copy</h3><label>Title<input data-field="title" value="${escapeHtml(draft.title)}" /></label><label>Description<textarea data-field="description">${escapeHtml(draft.description)}</textarea></label><div class="listings-bullets">${draft.bullets.map((bullet, index) => `<label>Bullet ${index + 1}<input data-bullet="${index}" value="${escapeHtml(bullet)}" /></label>`).join("")}</div><label>Base price (USD)<input data-price value="${escapeHtml(priceInput ?? (draft.basePriceCents / 100).toFixed(2))}" inputmode="decimal" /></label><label class="listings-check"><input type="checkbox" data-copy-approved ${draft.copyApproved ? "checked" : ""}/> Copy approved for later submission</label><button type="button" data-action="generate-copy" ${capabilities.copyGeneration ? "" : "disabled title=\"Copy generation is not configured.\""}>Generate copy</button></section><section class="listings-images-card"><h3>Gallery review</h3><p class="listings-image-count ${draft.images.filter(image => image.selected).length > 9 ? "is-over-limit" : ""}" role="status">${draft.images.filter(image => image.selected).length} of 9 images selected${draft.images.filter(image => image.selected).length > 9 ? " — reduce selection to 9 or fewer" : ""}</p><p>Select images independently from the approved main image. OpenAI image preparation can take a few minutes. Compare lettering, colors, edges, and clear hardware with the original before approving.</p><div class="listings-gallery">${draft.images.map((image) => `<article class="listings-image ${image.main ? "is-main" : ""}"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}"/><p>${escapeHtml(image.kind)}</p><label><input type="checkbox" data-image-select="${escapeHtml(image.id)}" ${image.selected ? "checked" : ""}/> Include</label><label><input type="radio" name="mainImage" data-image-main="${escapeHtml(image.id)}" ${image.main ? "checked" : ""}/> Main image</label><label><input type="checkbox" data-image-approved="${escapeHtml(image.id)}" ${image.approved ? "checked" : ""}/> Approved</label>${image.kind === "original" ? `<button type="button" data-prepare-image="${escapeHtml(image.id)}" ${capabilities.imagePreparation ? "" : "disabled title=\"Image preparation is not configured.\""}>Remove background</button>` : ""}</article>`).join("") || "<p>No images are available.</p>"}</div><div class="listings-dropzone" data-upload-zone role="region" aria-label="Image dropzone"><strong>Upload image</strong><p>Drag and drop your image here, or choose a file.</p><button type="button" class="batch-primary-action listings-choose-file" data-choose-file>Choose File</button><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload image" data-upload hidden /><span>JPEG, PNG, or WebP · Up to 3 MiB · One image at a time</span></div></section><section class="listings-source-card"><h3>Source facts</h3><dl>${Object.entries(draft.facts).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</dd></div>`).join("") || "<p>No source facts were returned.</p>"}</dl>${draft.warnings.length ? `<h4>Needs review</h4><ul>${draft.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}</section></div>`}</section></section>${errorDialog ? `<dialog class="listings-error-dialog" data-listings-error-dialog aria-labelledby="listings-error-title"><div class="listings-error-dialog-card"><header><div><p class="eyebrow">Request problem</p><h2 id="listings-error-title">Listing request failed</h2></div><form method="dialog"><button type="submit" class="listings-error-dialog-close" aria-label="Close error dialog">×</button></form></header><p>${escapeHtml(errorDialog.message)}</p><form method="dialog" class="listings-error-dialog-actions"><button type="submit" class="batch-primary-action" autofocus>OK</button></form></div></dialog>` : ""}`;
    if (draft) {
      const body = root.querySelector(".listings-editor-body");
      const sourceFacts = root.querySelector(".listings-source-card");
      const generateButton = root.querySelector("[data-action=generate-copy]");
      const header = root.querySelector(".listings-editor-header");
      const amazon = document.createElement("section");
      amazon.className = "listings-amazon-card";
      amazon.setAttribute("aria-label", "Amazon listing details");
      amazon.hidden = !revealedAmazonDrafts.has(draft.id) && !draft.bullets.some(bullet => bullet.trim());
      header.querySelector("h2").textContent = "Amazon listing details";
      header.querySelector(".eyebrow").textContent = "Editable draft";
      amazon.append(header);
      const amazonBody = document.createElement("div");
      amazonBody.className = "listings-amazon-body";
      amazonBody.append(root.querySelector(".listings-copy-card"), root.querySelector(".listings-images-card"));
      amazonBody.insertAdjacentHTML("beforeend", sandboxCard + renderProduction(draft, dirty));
      if (draft.warnings.length) amazonBody.insertAdjacentHTML("beforeend", `<section class="listings-review-notes"><h3>Needs review</h3><ul>${draft.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></section>`);
      amazon.append(amazonBody);
      sourceFacts.querySelector("h4")?.remove();
      sourceFacts.querySelector("ul")?.remove();
      const etsy = document.createElement("section");
      etsy.className = "listings-etsy-card";
      etsy.setAttribute("aria-label", "Etsy listing details");
      etsy.innerHTML = `<header><p class="eyebrow">Read-only source</p><h2>Etsy listing details</h2></header><h3>${escapeHtml(draft.sourceTitle)}</h3><p class="listings-source-description">${escapeHtml(draft.sourceDescription || "No source description available.")}</p><div class="listings-source-gallery">${draft.images.filter(image => image.kind === "original").map(image => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}"/>`).join("")}</div>`;
      etsy.append(sourceFacts);
      generateButton.classList.add("batch-primary-action", "listings-generate-button");
      const generationActions = document.createElement("div");
      generationActions.className = "listings-generation-actions";
      generationActions.append(generateButton);
      generationActions.insertAdjacentHTML("beforeend", '<button type="button" data-action="edit-prompt">Edit prompt</button>');
      body.replaceChildren(etsy, generationActions, amazon);
    }
    if (capabilities.amazonSandbox && !capabilities.amazonProduction) {
      const notice = root.querySelector(".listings-status");
      if (notice) notice.textContent = error || priceError || "Amazon sandbox is configured for canned protocol responses only. Production listing creation is disabled.";
    }
    updateValidation();
    if (loading) root.querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = true; });
    if (error && !draft) root.querySelector(".listings-empty")?.insertAdjacentHTML("afterbegin", `<p class="listings-status" role="alert">${escapeHtml(error)}</p>`);
    root.querySelector(".listings-status")?.classList.toggle("is-error", Boolean(error || priceError));
    if (promptEditor && !loading && !errorDialog) {
      root.insertAdjacentHTML("beforeend", `<dialog class="listings-error-dialog listings-confirm-dialog listings-prompt-dialog" aria-labelledby="listings-prompt-title"><form class="listings-error-dialog-card" data-prompt-form><header><h2 id="listings-prompt-title">Edit copy prompt</h2></header><p>This prompt applies to copy generation for all listings in this workspace. The imported Etsy listing text and up to ten original photos are supplied with this prompt. The app still requires five bullets and validates the response format.</p><label for="listing-copy-prompt">Prompt</label><textarea id="listing-copy-prompt" data-prompt-text required maxlength="20000" rows="18">${escapeHtml(promptEditor.text)}</textarea><div class="listings-error-dialog-actions"><button type="button" data-prompt-cancel>Cancel</button><button type="submit" class="batch-primary-action">Save</button></div></form></dialog>`);
      const promptDialog = root.querySelector(".listings-prompt-dialog");
      const cancelPrompt = () => { promptEditor = null; render(); root.querySelector('[data-action="edit-prompt"]')?.focus({ preventScroll: true }); };
      promptDialog.querySelector("[data-prompt-text]").addEventListener("input", event => { promptEditor.text = event.target.value; event.stopPropagation(); });
      promptDialog.querySelector("[data-prompt-cancel]").addEventListener("click", cancelPrompt);
      promptDialog.addEventListener("cancel", event => { event.preventDefault(); cancelPrompt(); });
      promptDialog.querySelector("form").addEventListener("submit", event => {
        event.preventDefault(); event.stopPropagation();
        const prompt = promptEditor.text;
        void request(() => saveListingCopyPrompt({ prompt, accessToken: token() }), () => { promptEditor = null; }, "Saving copy prompt...").then(result => { if (result) root.querySelector('[data-action="edit-prompt"]')?.focus({ preventScroll: true }); });
      });
      promptDialog.showModal();
      promptDialog.querySelector("textarea").focus();
    }
    if (loading) {
      root.insertAdjacentHTML("beforeend", `<dialog class="listings-working-dialog" aria-labelledby="listings-working-title" aria-describedby="listings-working-note"><div class="operation-progress"><span class="operation-progress-spinner" aria-hidden="true"></span><div><h2 id="listings-working-title" class="operation-progress-label" tabindex="-1">${escapeHtml(workingMessage)}</h2><p id="listings-working-note" class="operation-progress-note">Please keep this page open. Generation can take a few minutes.</p></div></div></dialog>`);
      const workingDialog = root.querySelector(".listings-working-dialog");
      workingDialog.addEventListener("cancel", (event) => event.preventDefault());
      workingDialog.showModal();
      workingDialog.querySelector("h2").focus();
    }
    if (resultDialog && !loading && !errorDialog) {
      root.insertAdjacentHTML("beforeend", `<dialog class="listings-error-dialog listings-confirm-dialog listings-result-dialog" aria-labelledby="production-result-title"><div class="listings-error-dialog-card"><h2 id="production-result-title">Amazon production result</h2><p>${escapeHtml(resultDialog.message)}</p><button type="button" class="batch-primary-action" data-result-close>OK</button></div></dialog>`);
      const dialog = root.querySelector('.listings-result-dialog');
      const close = () => { const focus = resultDialog.focus; resultDialog = null; render(); root.querySelector(focus)?.focus({ preventScroll: true }); };
      dialog.querySelector('button').addEventListener('click', close);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.showModal(); dialog.querySelector('button').focus();
    }
    if (confirmation) {
      root.insertAdjacentHTML("beforeend", `<dialog class="listings-error-dialog listings-confirm-dialog" aria-labelledby="listings-confirm-title" aria-describedby="listings-confirm-message"><div class="listings-error-dialog-card"><header><h2 id="listings-confirm-title">${escapeHtml(confirmation.title)}</h2><button type="button" class="listings-error-dialog-close" data-confirm-cancel aria-label="Close confirmation">&#215;</button></header><p id="listings-confirm-message">${escapeHtml(confirmation.message)}</p><div class="listings-error-dialog-actions"><button type="button" data-confirm-cancel autofocus>Cancel</button><button type="button" class="batch-primary-action" data-confirm-accept>${escapeHtml(confirmation.label)}</button></div></div></dialog>`);
      const confirmationDialog = root.querySelector(".listings-confirm-dialog");
      confirmationDialog.querySelectorAll("[data-confirm-cancel]").forEach(button => button.addEventListener("click", () => finishConfirmation(false)));
      confirmationDialog.querySelector("[data-confirm-accept]").addEventListener("click", () => finishConfirmation(true));
      confirmationDialog.addEventListener("cancel", event => { event.preventDefault(); finishConfirmation(false); });
      confirmationDialog.showModal();
      confirmationDialog.querySelector("[autofocus]").focus();
    }
    const dialog = root.querySelector("[data-listings-error-dialog]");
    if (dialog) {
      dialog.addEventListener("close", dismissErrorDialog, { once: true });
      dialog.showModal();
      dialog.querySelector("[autofocus]")?.focus();
    }
  };
  const replace = (next, requestEpoch = epoch) => { if (requestEpoch !== epoch) return false; const index = drafts.findIndex((draft) => draft.id === next.id); const stored = saveSnapshot(next); if (index >= 0) drafts[index] = stored; else drafts = [stored, ...drafts]; selectedId = stored.id; priceError = ""; priceInput = null; render(); return true; };
  const isDirty = (draft = selected()) => Boolean(priceError || (draft && Object.keys(getChanges(draft)).length));
  function markDirty() { const draft = selected(); if (draft) { const state = productionState(draft); const dirty = isDirty(draft); for (const [action, disabled] of [["production-validate", dirty], ["production-submit", dirty || !state.canSubmit], ["production-status", dirty || !state.submitted]]) { const button = root.querySelector(`[data-action="${action}"]`); if (button) button.disabled = disabled || loading; } } const save = root.querySelector("[data-action=save]"); if (save) save.disabled = !draft || !isDirty(draft) || loading || Boolean(priceError); const copyApproved = root.querySelector("[data-copy-approved]"); if (copyApproved && draft) copyApproved.checked = draft.copyApproved; const status = root.querySelector(".listings-editor-header p:last-child"); if (status && draft) status.textContent = isDirty(draft) ? "Unsaved changes" : "Saved draft"; const notice = root.querySelector(".listings-status"); notice?.classList.toggle("is-error", Boolean(error || priceError)); if (notice) notice.textContent = error || priceError || (capabilities.amazon ? "Amazon connection available for a later review step." : "Amazon submission is unavailable until account access and schema validation are complete."); }
  function blockDirtyAction(message) { if (!isDirty()) return false; error = priceError || message; showErrorDialog(error); render(); return true; }
  async function request(operation, applyResult = null, message = "Updating listing...") { if (loading) return null; const requestEpoch = epoch; const requestFocusSelector = dialogFocusSelector(); loading = true; workingMessage = message; error = ""; errorDialog = null; render(); try { const result = await runAuthenticatedRequest(() => operation(), { accessToken: token(), onAccessToken(nextToken) { if (requestEpoch !== epoch) return; refreshedToken = nextToken; onAccessToken?.(nextToken); } }); if (requestEpoch !== epoch) return null; applyResult?.(result, requestEpoch); return result; } catch (caught) { if (requestEpoch === epoch) { error = caught instanceof Error ? caught.message : "Unable to update listing draft."; if (caught?.status === 401) onAuthenticationRequired(caught.message); else showErrorDialog(error, requestFocusSelector); } return null; } finally { if (requestEpoch === epoch) { loading = false; render(); if (!errorDialog && requestFocusSelector) root.querySelector(requestFocusSelector)?.focus(); } } }
  async function load(id = null) { if (loading || (hasLoaded && (!id || selectedId === id))) return; if (isDirty() && !window.confirm("Discard unsaved listing edits before loading another draft?")) return; await request(() => fetchListings({ id, accessToken: token() }), (payload, requestEpoch) => { capabilities = payload.capabilities || capabilities; hasLoaded = true; if (payload.draft) replace(payload.draft, requestEpoch); else { drafts = (payload.drafts || []).map(saveSnapshot); selectedId = id && drafts.some((draft) => draft.id === id) ? id : drafts[0]?.id || null; priceError = ""; render(); } }); }
  root.addEventListener("submit", (event) => { if (!event.target.matches("[data-action=import]")) return; event.preventDefault(); if (loading) return; if (isDirty() && !window.confirm("Discard unsaved listing edits before importing another Etsy listing?")) return; const source = new FormData(event.target).get("source"); void request(() => importEtsyListing({ source, accessToken: token() }), (payload, requestEpoch) => { capabilities = payload.capabilities || capabilities; if (replace(payload.draft, requestEpoch)) onSelect(payload.draft.id); }); });
  root.addEventListener("click", async (event) => { if (loading || confirmation) return; const actionEpoch = epoch; const selectButton = event.target.closest("[data-select]"); if (selectButton) { if (selected()?.id !== selectButton.dataset.select && isDirty() && !window.confirm("Discard unsaved listing edits?")) return; selectedId = selectButton.dataset.select; priceError = ""; priceInput = null; error = ""; render(); onSelect(selectedId); return; } const action = event.target.closest("[data-action]")?.dataset.action; const draft = selected(); if (!draft) return; if (action === "edit-prompt") { void request(() => fetchListingCopyPrompt({ accessToken: token() }), payload => { promptEditor = { text: payload.prompt }; }, "Loading copy prompt..."); return; } if (action === "save") void request(() => saveListingDraft({ id: draft.id, revision: draft.revision, changes: getChanges(draft), accessToken: token() }), (payload, requestEpoch) => replace(payload.draft, requestEpoch)); if (action === "generate-copy") { revealedAmazonDrafts.add(draft.id); if (blockDirtyAction("Save draft before generating copy.")) return; if (!await confirmAction("Replace listing copy?", "Generate a new title, description, and five bullet points? These will replace the current saved copy when generation succeeds. Review the new copy before approving it.", "Replace copy") || actionEpoch !== epoch) return; void request(() => runListingAction({ action: "generateCopy", id: draft.id, revision: draft.revision, accessToken: token() }), (payload, requestEpoch) => replace(payload.draft, requestEpoch), "Generating listing copy..."); } const imageId = event.target.closest("[data-prepare-image]")?.dataset.prepareImage; if (imageId) { if (blockDirtyAction("Save draft before preparing an image.")) return; if (!await confirmAction("Prepare main image?", "Create a white-background image from this photo? The original will be kept, and the new image will need your review and approval.", "Prepare image") || actionEpoch !== epoch) return; void request(() => runListingAction({ action: "prepareImage", id: draft.id, revision: draft.revision, imageId, accessToken: token() }), (payload, requestEpoch) => replace(payload.draft, requestEpoch), "Preparing main image..."); } });
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const sandboxAction = { "sandbox-preview": "validateAmazonSandbox", "sandbox-submit": "submitAmazonSandbox", "sandbox-status": "reconcileAmazonSandbox" }[action];
    if (!sandboxAction || loading) return;
    const draft = selected();
    if (!draft) return;
    validationDrafts.add(draft.id); updateValidation();
    if (blockDirtyAction("Save draft before running the sandbox action.")) return;
    const state = sandboxState(draft);
    if ((sandboxAction === "submitAmazonSandbox" && (!state.previewReady || state.pendingSubmission || state.unknownSubmission || localReadiness(draft).length)) || (sandboxAction === "reconcileAmazonSandbox" && !state.needsReconcile)) return;
    void request(() => runListingAction({ action: sandboxAction, id: draft.id, revision: draft.revision, accessToken: token() }), (payload, requestEpoch) => replace(payload.draft, requestEpoch));
  });
  root.addEventListener("click", async event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const apiAction = { "production-validate": "validateAmazonProduction", "production-submit": "submitAmazonProduction", "production-status": "reconcileAmazonProduction" }[action];
    if (!apiAction || loading || confirmation) return;
    const draft = selected(); if (!draft) return;
    validationDrafts.add(draft.id); updateValidation();
    if (blockDirtyAction("Save draft before contacting Amazon production.")) return;
    const state = productionState(draft); const actionEpoch = epoch;
    if (action === "production-validate") {
      const detailIssues = productionDetailIssues(draft.amazonProductionDetails);
      if (Object.keys(detailIssues).length) {
        error = "Complete the highlighted Amazon production details before validation.";
        const firstInvalid = Object.keys(detailIssues)[0];
        showErrorDialog(error, `[data-production-detail="${firstInvalid}"]`);
        render();
        return;
      }
    }
    if (action === "production-submit") {
      if (!state.canSubmit) return;
      if (!await confirmAction("Create an actual Amazon listing?", "This sends the approved product details and images to your production Amazon seller account without price or inventory. Amazon acceptance does not confirm processing is complete. Check its status after creation.", "Create inactive listing") || actionEpoch !== epoch) return;
    }
    if (action === "production-status" && !state.submitted) return;
    await request(() => runListingAction({ action: apiAction, id: draft.id, revision: draft.revision, ...(action === "production-submit" ? { confirmProduction: true } : {}), accessToken: token() }), (payload, requestEpoch) => {
      replace(payload.draft, requestEpoch);
      const attempt = payload.draft.amazonProduction?.attempts?.filter(a => a.action === (action === "production-submit" ? "submit" : action === "production-status" ? "reconcile" : "validate")).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      const issues = (attempt?.issues || []).filter(issue => String(issue.severity).toUpperCase() === "ERROR");
      if (issues.length || ["invalid", "failed", "buyable"].includes(attempt?.status)) {
        error = issues.map(issue => issue.message).join(" ") || (attempt?.status === "buyable" ? "Amazon reports this listing is buyable. Review the listing in Seller Central immediately." : "Amazon could not validate this listing. Review the production attempt issues and correct the draft.");
        showErrorDialog(error, `[data-action="${action}"]`); return;
      }
      const messages = { checked: "Amazon validation passed. No listing was created. You can now review and confirm creation.", accepted: "Amazon accepted the submission for processing. This does not yet confirm an inactive listing. Use Check Amazon status to verify the result.", inactive: "Amazon reports the listing is inactive and not buyable. Review it in Seller Central before adding sales terms.", unknown: "The submission outcome is unknown. Check Amazon status before any further submission.", unconfirmed: "Amazon has not confirmed the listing state yet. Check Amazon status again later." };
      resultDialog = { message: messages[attempt?.status] || "Amazon returned a result. Review the production attempt history for details.", focus: `[data-action="${action}"]` };
    }, action === "production-validate" ? "Validating with Amazon..." : action === "production-submit" ? "Creating inactive Amazon listing..." : "Checking Amazon listing status...");
  });
  root.addEventListener("input", event => {
    if (!event.target.matches("[data-image-select]")) return;
    const count = root.querySelectorAll("[data-image-select]:checked").length;
    const counter = root.querySelector(".listings-image-count");
    if (counter) {
      counter.textContent = `${count} of 9 images selected${count > 9 ? " — reduce selection to 9 or fewer" : ""}`;
      counter.classList.toggle("is-over-limit", count > 9);
    }
  });
  root.addEventListener("input", (event) => { if (event.target.matches("input[type=checkbox], input[type=radio], input[type=file]")) return; if (event.target.name === "source") { importInput = event.target.value; return; } error = ""; const draft = selected(); if (!draft || loading) return; const target = event.target; if (target.dataset.field) drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { [target.dataset.field]: target.value }); if (target.dataset.bullet !== undefined) { const bullets = [...draft.bullets]; bullets[Number(target.dataset.bullet)] = target.value; drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { bullets }); } if (target.dataset.productionDetail) drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { amazonProductionDetails: { ...draft.amazonProductionDetails, [target.dataset.productionDetail]: target.value } }); if (target.dataset.price !== undefined) { priceInput = target.value; const amount = Number(target.value); priceError = !target.value.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 10000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ? "Enter a valid base price." : ""; if (!priceError) drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { basePriceCents: Math.round(amount * 100) }); } markDirty(); updateValidation(); });
  root.addEventListener("change", (event) => { const draft = selected(); if (!draft || loading) return; const target = event.target; let changed = false; if (target.dataset.copyApproved !== undefined) { drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { copyApproved: target.checked }); changed = true; } if (target.dataset.imageSelect) { drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { imageId: target.dataset.imageSelect, selected: target.checked }); changed = true; } if (target.dataset.imageMain) { drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { imageId: target.dataset.imageMain, main: true }); changed = true; } if (target.dataset.imageApproved) { drafts[drafts.indexOf(draft)] = applyDraftChanges(draft, { imageId: target.dataset.imageApproved, approved: target.checked }); changed = true; } if (target.matches("[data-upload]") && target.files?.[0]) { const file = target.files[0]; void uploadImage(file); return; } if (changed) {
    const scrollPositions = [];
    for (let node = target.parentElement; node; node = node.parentElement) {
      if (node.scrollTop || node.scrollLeft) scrollPositions.push({ node, top: node.scrollTop, left: node.scrollLeft, editor: node.matches(".listings-editor") });
    }
    const pagePosition = { left: window.scrollX, top: window.scrollY };
    const focusAttribute = ["data-copy-approved", "data-image-select", "data-image-main", "data-image-approved"].find(attribute => target.hasAttribute(attribute));
    const focusValue = focusAttribute && target.getAttribute(focusAttribute);
    render();
    if (focusAttribute) Array.from(root.querySelectorAll(`[${focusAttribute}]`)).find(control => control.getAttribute(focusAttribute) === focusValue)?.focus({ preventScroll: true });
    for (const position of scrollPositions) {
      const node = position.editor ? root.querySelector(".listings-editor") : position.node;
      if (node?.isConnected) node.scrollTo({ top: position.top, left: position.left, behavior: "instant" });
    }
    window.scrollTo({ ...pagePosition, behavior: "instant" });
  } });
  async function uploadImage(file) {
    const draft = selected();
    if (!draft || loading) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 3 * 1024 * 1024) {
      error = "Upload a JPEG, PNG, or WebP image no larger than 3 MiB.";
      showErrorDialog(error); render(); return;
    }
    const requestDraft = { id: draft.id, revision: draft.revision };
    const fileEpoch = epoch;
    await request(async () => {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("Unable to read that image file."));
        reader.readAsDataURL(file);
      });
      if (fileEpoch !== epoch || selectedId !== requestDraft.id) return null;
      return runListingAction({ action: "uploadImage", ...requestDraft, file: { name: file.name, type: file.type, dataBase64 }, accessToken: token() });
    }, (payload, requestEpoch) => {
      if (!payload || requestEpoch !== epoch || selectedId !== requestDraft.id) return;
      const current = selected();
      drafts[drafts.indexOf(current)] = mergeUploadedDraft(current, payload.draft);
    }, "Uploading image...");
  }
  root.addEventListener("click", event => {
    if (!loading && event.target.closest("[data-choose-file]")) root.querySelector("[data-upload]")?.click();
  });
  root.addEventListener("dragover", event => {
    const zone = event.target.closest("[data-upload-zone]");
    if (!zone) return;
    event.preventDefault();
    if (!loading) { zone.classList.add("is-dragging"); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; }
  });
  root.addEventListener("dragleave", event => {
    const zone = event.target.closest("[data-upload-zone]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("is-dragging");
  });
  root.addEventListener("drop", event => {
    const zone = event.target.closest("[data-upload-zone]");
    if (!zone) return;
    event.preventDefault(); zone.classList.remove("is-dragging");
    if (loading) return;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length !== 1) { error = "Upload one image at a time."; showErrorDialog(error); render(); return; }
    void uploadImage(files[0]);
  });
  return { get selectedId() { return selectedId; }, open: (id = null) => load(id), reset() { resultDialog = null; validationDrafts.clear(); promptEditor = null; revealedAmazonDrafts.clear(); epoch += 1; const pendingConfirmation = confirmation; confirmation = null; pendingConfirmation?.resolve(false); drafts = []; selectedId = null; hasLoaded = false; refreshedToken = null; capabilities = { amazon: false, copyGeneration: false, imagePreparation: false }; error = ""; errorDialog = null; priceError = ""; priceInput = null; importInput = ""; loading = false; render(); } };
}
