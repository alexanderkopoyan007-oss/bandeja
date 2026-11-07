# Process one synchronized recording folder with FreeMoCap, no GUI, no Blender:  python -I run_headless.py <recording> [calibration.toml]
import sys, time
from freemocap.core_processes.process_motion_capture_videos.process_recording_headless import process_recording_headless, find_calibration_toml_path
from freemocap.data_layer.recording_models.recording_info_model import RecordingInfoModel

rec = sys.argv[1]
toml = sys.argv[2] if len(sys.argv) > 2 else find_calibration_toml_path(rec)
info = RecordingInfoModel(recording_folder_path=rec, active_tracker='mediapipe')
t = time.time()
process_recording_headless(recording_path=rec, path_to_camera_calibration_toml=toml, recording_info_model=info,
                           run_blender=False, make_jupyter_notebook=False, use_tqdm=False)
print('DONE', round(time.time() - t, 1), 's ->', info.output_data_folder_path)
