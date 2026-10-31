# Predictive City Arteries – Frontend

## Files
- `frontend/enhanced_index.html`
- `frontend/static/enhanced_style.css`
- `frontend/static/enhanced_script.js`

## Expected backend layout
Place this `frontend` folder beside your existing `app` folder:

```text
your-project/
├── app/
│   ├── main.py
│   └── models/
│       └── best.pt
├── frontend/
│   ├── enhanced_index.html
│   └── static/
│       ├── enhanced_style.css
│       └── enhanced_script.js
└── temp/
```

Your existing FastAPI code already serves the HTML at `/`, serves static files from `/static`, accepts uploads at `/upload`, and streams processed frames at `/ws/stream`.

## Required backend addition for CSV download

Your current backend creates the CSV but does not expose a download route. Add this route to `app/main.py` after the `/upload` route (or anywhere before starting the app):

```python
from fastapi import HTTPException

@app.get("/download/{filename}")
async def download_report(filename: str):
    # Prevent path traversal and only serve files from temp_video_dir.
    safe_name = Path(filename).name
    report_path = temp_video_dir / safe_name

    if not report_path.is_file() or not safe_name.endswith("_traffic_report.csv"):
        raise HTTPException(status_code=404, detail="Report not found")

    return FileResponse(
        report_path,
        media_type="text/csv",
        filename=safe_name
    )
```

## Run
From the project root (the folder containing `app` and `frontend`):

```powershell
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`.

Install your backend dependencies in the same Python environment, including `fastapi`, `uvicorn`, `python-multipart`, `ultralytics`, `opencv-python`, and `pandas`.

## Important accuracy notes about the supplied backend

The interface displays the values returned by your backend. It does not independently improve the model's tracking or speed calibration.

1. Your code currently calls `model.predict(...)`, not YOLO tracking. `boxes.id` will normally be `None`; the fallback `obj_id = i` is only a detection's position in the current frame, not a persistent vehicle ID. Therefore `vehicle_ids_seen` does not reliably count unique vehicles. Use a tracker such as `model.track(frame, persist=True, ...)` and validate IDs before presenting the value as unique vehicles.
2. `sqrt(dx² + dy²)` is pixel displacement per processed frame, not physical speed. The `0.05` multiplier is not a valid km/h calibration unless calibrated for the camera perspective and video frame rate. Treat the km/h figures as estimates until calibrated.
3. Lane counts are accumulated frame detections, not unique vehicles per lane. The current proportion-based lane split is an estimate, not a true lane-specific vehicle count.
4. Signal timings are prototype recommendations based on fixed thresholds. They do not control real traffic lights and should not be presented as deployed signal control.
5. The backend uses the first coordinate `x1` and a fixed `lane_threshold = 609`; confirm that this matches the uploaded video's resolution and lane geometry.

The PDF currently available in this conversation has only four pages and does not specify additional technical modules or UI requirements. The frontend above is therefore wired to the API contract in the Python code you supplied.
