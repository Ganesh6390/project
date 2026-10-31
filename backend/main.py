from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from ultralytics import YOLO
import tempfile, shutil, base64, os, cv2
import pandas as pd

app = FastAPI()
frontend_dir = Path(__file__).parent.parent / "frontend"
temp_video_dir = Path(__file__).parent / "temp"
temp_video_dir.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory=frontend_dir / "static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", response_class=FileResponse)
async def serve_index():
    return FileResponse(frontend_dir / "enhanced_index.html")


# Upload video
@app.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    file_path = temp_video_dir / file.filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return JSONResponse(content={"filename": file.filename})


# WebSocket streaming
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        message = await websocket.receive_json()
        filename = message.get("filename")
        video_path = temp_video_dir / filename

        if not video_path.exists():
            await websocket.send_json({"error": "Video file not found."})
            return

        model_path = Path(__file__).parent / "models" / "best.pt"
        if not model_path.exists():
            await websocket.send_json({"error": "Model file not found."})
            return

        model = YOLO(str(model_path))
        cap = cv2.VideoCapture(str(video_path))

        if not cap.isOpened():
            await websocket.send_json({"error": "Failed to open video file."})
            return

        prev_centroids, speeds = {}, {}
        lane_threshold = 609
        frame_idx = 0
        total_objects = 0
        all_speeds = []
        total_left, total_right = 0, 0
        vehicle_ids_seen = set()

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            results = model.predict(frame, imgsz=640, conf=0.4)
            boxes = results[0].boxes.xyxy
            ids = getattr(results[0].boxes, 'id', None)

            left = sum(1 for box in boxes if box[0] < lane_threshold)
            right = sum(1 for box in boxes if box[0] >= lane_threshold)

            curr_centroids, box_list, speed_list = {}, [], []

            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = map(int, box)
                cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
                obj_id = int(ids[i]) if ids is not None else i

                curr_centroids[obj_id] = (cx, cy)
                box_list.append([x1, y1, x2, y2])
                vehicle_ids_seen.add(obj_id)

                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, f'ID {obj_id}', (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)

                if obj_id in prev_centroids:
                    dx = cx - prev_centroids[obj_id][0]
                    dy = cy - prev_centroids[obj_id][1]
                    speed = (dx**2 + dy**2)**0.5
                    speeds[obj_id] = speed
                else:
                    speeds[obj_id] = 0.0

                speed_list.append(speeds[obj_id])

            prev_centroids = curr_centroids.copy()
            avg_speed = round(sum(speed_list) / len(speed_list), 2) if speed_list else 0.0

            _, buffer = cv2.imencode(".jpg", frame)
            img_str = base64.b64encode(buffer).decode("utf-8")

            total_objects += len(box_list)
            all_speeds.extend(speed_list)
            total_left += left
            total_right += right

            await websocket.send_json({
                "image": img_str,
                "frame": frame_idx,
                "boxes": box_list,
                "left_count": left,
                "right_count": right,
                "speeds": speed_list,
                "avg_speed": avg_speed
            })
            frame_idx += 1

        cap.release()

        # ==============================
        # NEW: TRAFFIC DECISION ANALYSIS
        # ==============================

        avg_speed_units = round(sum(all_speeds) / len(all_speeds), 2) if all_speeds else 0
        max_speed_units = round(max(all_speeds), 2) if all_speeds else 0

        # Convert to km/h (calibration factor)
        SPEED_CONVERSION = 0.05
        avg_speed_kmh = round(avg_speed_units * SPEED_CONVERSION, 2)
        max_speed_kmh = round(max_speed_units * SPEED_CONVERSION, 2)

        # Most used lane
        if total_left > total_right:
            most_used_lane = "Left Lane"
        elif total_right > total_left:
            most_used_lane = "Right Lane"
        else:
            most_used_lane = "Both lanes equally used"

        total_vehicles_passed = len(vehicle_ids_seen)

        # Vehicles passed per lane (proportion method)
        total_lane_detections = total_left + total_right
        if total_lane_detections > 0:
            left_passed = int((total_left / total_lane_detections) * total_vehicles_passed)
            right_passed = total_vehicles_passed - left_passed
        else:
            left_passed = right_passed = 0

        # Signal timing per lane
        def get_signal_time(count):
            if count < 5:
                return 20
            elif count < 10:
                return 40
            else:
                return 60

        left_signal_time = get_signal_time(left_passed)
        right_signal_time = get_signal_time(right_passed)

        # ==============================
        # CSV REPORT (Video Based)
        # ==============================
        video_name = os.path.basename(video_path)

        report_data = {
            "Video Name": video_name,
            "Total Frames": frame_idx,
            "Total Detections": total_objects,
            "Average Objects per Frame": round(total_objects / frame_idx, 2) if frame_idx else 0,
            "Average Speed (units)": avg_speed_units,
            "Average Speed (km/h)": avg_speed_kmh,
            "Max Speed (units)": max_speed_units,
            "Max Speed (km/h)": max_speed_kmh,
            "Total Left Lane Detections": total_left,
            "Total Right Lane Detections": total_right,
            "Total Vehicles Passed": total_vehicles_passed,
            "Vehicles Passed Left Lane": left_passed,
            "Vehicles Passed Right Lane": right_passed,
            "Most Used Lane": most_used_lane,
            "Left Lane Signal Time (sec)": left_signal_time,
            "Right Lane Signal Time (sec)": right_signal_time
        }

        csv_filename = f"{video_name}_traffic_report.csv"
        df = pd.DataFrame([report_data])
        df.to_csv(temp_video_dir / csv_filename, index=False)

        # ==============================
        # FINAL SUMMARY (Send to Frontend)
        # ==============================
        summary = {
            "summary": True,
            "total_frames": frame_idx,
            "total_objects": total_objects,
            "avg_objects": round(total_objects / frame_idx, 2) if frame_idx else 0,
            "avg_speed": avg_speed_units,
            "max_speed": max_speed_units,
            "avg_speed_kmh": avg_speed_kmh,
            "max_speed_kmh": max_speed_kmh,
            "left_total": total_left,
            "right_total": total_right,
            "most_used_lane": most_used_lane,
            "total_vehicles_passed": total_vehicles_passed,
            "left_passed": left_passed,
            "right_passed": right_passed,
            "left_signal_time": left_signal_time,
            "right_signal_time": right_signal_time,
            "report_file": csv_filename
        }

        await websocket.send_json(summary)

    except Exception as e:
        print("WebSocket error:", str(e))
        await websocket.send_json({"error": str(e)})
    finally:
        await websocket.close()
