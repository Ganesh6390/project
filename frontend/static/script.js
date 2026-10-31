const API_BASE = window.location.origin;
const fileInput = document.getElementById("videoFile");
const dropZone = document.getElementById("dropZone");
const startButton = document.getElementById("startButton");
const fileRow = document.getElementById("fileRow");
const message = document.getElementById("message");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const processedFrame = document.getElementById("processedFrame");
const previewStatus = document.getElementById("previewStatus");
const downloadReport = document.getElementById("downloadReport");

let selectedFile = null;
let socket = null;
let uploadedFilename = null;
let processing = false;
let framesReceived = 0;
let lastReportUrl = null;

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}
function formatBytes(bytes) {
  if (!bytes) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function selectFile(file) {
  if (!file) return;
  const allowed = /\.(mp4|avi|mov|mkv)$/i.test(file.name);
  if (!allowed) {
    setMessage("Please select an MP4, AVI, MOV or MKV video.", "error");
    return;
  }
  selectedFile = file;
  document.getElementById("fileName").textContent = file.name;
  document.getElementById("fileSize").textContent = formatBytes(file.size);
  fileRow.hidden = false;
  startButton.disabled = false;
  setMessage("Video selected. Ready to upload.");
}
fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
document.getElementById("removeFile").addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileRow.hidden = true;
  startButton.disabled = true;
  setMessage("Select a video to begin.");
});
["dragenter", "dragover"].forEach(name => dropZone.addEventListener(name, e => {
  e.preventDefault(); dropZone.classList.add("dragover");
}));
["dragleave", "drop"].forEach(name => dropZone.addEventListener(name, e => {
  e.preventDefault(); dropZone.classList.remove("dragover");
}));
dropZone.addEventListener("drop", e => selectFile(e.dataTransfer.files[0]));

function resetResults() {
  framesReceived = 0;
  uploadedFilename = null;
  lastReportUrl = null;
  downloadReport.href = "#";
  downloadReport.classList.add("disabled");
  downloadReport.setAttribute("aria-disabled", "true");
  document.getElementById("reportStatus").textContent = "No report generated";
  document.getElementById("analysisState").textContent = "Processing video";
  document.getElementById("totalVehicles").textContent = "—";
  document.getElementById("avgSpeed").textContent = "—";
  document.getElementById("maxSpeed").textContent = "—";
  document.getElementById("totalFrames").textContent = "—";
  document.getElementById("leftCount").textContent = "—";
  document.getElementById("rightCount").textContent = "—";
  document.getElementById("leftSignal").textContent = "—";
  document.getElementById("rightSignal").textContent = "—";
  document.getElementById("mostUsedLane").textContent = "—";
  document.getElementById("leftBar").style.width = "0%";
  document.getElementById("rightBar").style.width = "0%";
  document.getElementById("signalNote").textContent = "Signal recommendations will be displayed after analysis.";
  document.getElementById("frameNumber").textContent = "—";
  document.getElementById("frameDetections").textContent = "—";
  document.getElementById("frameSpeed").textContent = "—";
  processedFrame.hidden = true;
  document.querySelector(".preview-placeholder").hidden = false;
}
function setBusy(busy) {
  processing = busy;
  startButton.disabled = busy || !selectedFile;
  startButton.innerHTML = busy ? "<span>◌</span> Processing video…" : "<span>▶</span> Upload &amp; analyse video";
  progressWrap.hidden = !busy;
  previewStatus.textContent = busy ? "PROCESSING" : "STANDBY";
  document.querySelector(".live-label").classList.toggle("active", busy);
}
function updateLaneBars(left, right) {
  const total = left + right;
  document.getElementById("leftBar").style.width = total ? `${left / total * 100}%` : "0%";
  document.getElementById("rightBar").style.width = total ? `${right / total * 100}%` : "0%";
}
function displayFrame(data) {
  if (data.image) {
    processedFrame.src = `data:image/jpeg;base64,${data.image}`;
    processedFrame.hidden = false;
    document.querySelector(".preview-placeholder").hidden = true;
  }
  framesReceived++;
  document.getElementById("frameNumber").textContent = data.frame ?? framesReceived;
  document.getElementById("frameDetections").textContent = Array.isArray(data.boxes) ? data.boxes.length : "—";
  document.getElementById("frameSpeed").textContent = data.avg_speed ?? "—";
  document.getElementById("analysisState").textContent = `Processing · ${framesReceived} frames received`;
  // The backend does not send a total frame count before processing completes.
  const estimated = Math.min(95, Math.max(3, framesReceived / (framesReceived + 20) * 100));
  progressBar.style.width = `${estimated}%`;
  progressPercent.textContent = `${Math.round(estimated)}%`;
}
function displaySummary(data) {
  document.getElementById("totalVehicles").textContent = data.total_vehicles_passed ?? data.total_objects ?? "—";
  document.getElementById("avgSpeed").textContent = data.avg_speed_kmh ?? "—";
  document.getElementById("maxSpeed").textContent = data.max_speed_kmh ?? "—";
  document.getElementById("totalFrames").textContent = data.total_frames ?? "—";
  document.getElementById("leftCount").textContent = data.left_total ?? "—";
  document.getElementById("rightCount").textContent = data.right_total ?? "—";
  document.getElementById("mostUsedLane").textContent = data.most_used_lane ?? "—";
  document.getElementById("leftSignal").textContent = data.left_signal_time ?? "—";
  document.getElementById("rightSignal").textContent = data.right_signal_time ?? "—";
  updateLaneBars(Number(data.left_total || 0), Number(data.right_total || 0));
  document.getElementById("signalNote").textContent =
    `Based on the current lane estimates, the suggested green durations are ${data.left_signal_time ?? "—"} seconds for the left lane and ${data.right_signal_time ?? "—"} seconds for the right lane. These are prototype recommendations, not live traffic-signal controls.`;
  document.getElementById("analysisState").textContent = "Analysis completed";
  progressBar.style.width = "100%";
  progressPercent.textContent = "100%";
  document.getElementById("progressLabel").textContent = "Analysis complete";
  setMessage("Video analysis completed successfully.", "success");
  if (data.report_file) {
    const url = `${API_BASE}/download/${encodeURIComponent(data.report_file)}`;
    downloadReport.href = url;
    downloadReport.classList.remove("disabled");
    downloadReport.removeAttribute("aria-disabled");
    document.getElementById("reportStatus").textContent = "CSV report ready";
  } else {
    document.getElementById("reportStatus").textContent = "Report filename not returned";
  }
  setBusy(false);
  if (socket && socket.readyState === WebSocket.OPEN) socket.close();
}
async function uploadVideo() {
  if (!selectedFile || processing) return;
  resetResults();
  setBusy(true);
  setMessage("Uploading video to the FastAPI server…");
  document.getElementById("progressLabel").textContent = "Uploading video…";
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    const response = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.detail || result.error || "Video upload failed.");
    uploadedFilename = result.filename;
    setMessage("Upload complete. Connecting to the video processor…", "success");
    connectWebSocket(uploadedFilename);
  } catch (error) {
    setBusy(false);
    setMessage(error.message || "Unable to upload video. Check that the FastAPI server is running.", "error");
    document.getElementById("analysisState").textContent = "Upload failed";
  }
}
function connectWebSocket(filename) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/stream`);
  socket.onopen = () => {
    socket.send(JSON.stringify({ filename }));
    document.getElementById("progressLabel").textContent = "YOLO is processing frames…";
    setMessage("Video processing started. Detection frames will appear below.");
  };
  socket.onmessage = event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.error) {
      setBusy(false);
      setMessage(data.error, "error");
      document.getElementById("analysisState").textContent = "Processing error";
      return;
    }
    if (data.summary) displaySummary(data);
    else displayFrame(data);
  };
  socket.onerror = () => {
    setBusy(false);
    setMessage("WebSocket connection failed. Confirm that the backend is running and /ws/stream is available.", "error");
    document.getElementById("analysisState").textContent = "Connection failed";
  };
  socket.onclose = () => {
    if (processing && document.getElementById("analysisState").textContent !== "Analysis completed") {
      setBusy(false);
    }
  };
}
startButton.addEventListener("click", uploadVideo);
window.addEventListener("beforeunload", () => {
  if (socket && socket.readyState === WebSocket.OPEN) socket.close();
});
