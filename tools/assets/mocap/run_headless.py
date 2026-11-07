# Process one synchronized recording folder with FreeMoCap, no GUI, no Blender:
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/run_headless.py <recording> [calibration.toml]
# Its defaults are set for webcams at 30 fps and one process. Here: the recording's frame rate from sync.json (FreeMoCap's
# Butterworth filter is specified in Hz, at that rate: left at 30 for 120 fps footage it cut at four times its 7 Hz),
# and one tracking process a phone (one in all took hours for a ten-minute recording at 120 fps).
import json, os, sys, time
from freemocap.core_processes.process_motion_capture_videos.process_recording_headless import process_recording_headless, find_calibration_toml_path
from freemocap.data_layer.recording_models.post_processing_parameter_models import ProcessingParameterModel
from freemocap.data_layer.recording_models.recording_info_model import RecordingInfoModel

if __name__ == '__main__':
    rec = sys.argv[1]
    toml = sys.argv[2] if len(sys.argv) > 2 else find_calibration_toml_path(rec)
    sj = os.path.join(rec, 'sync.json')
    fps = float(json.load(open(sj))['fps']) if os.path.exists(sj) else 30.0
    cams = len([v for v in os.listdir(os.path.join(rec, 'synchronized_videos')) if v.lower().endswith(('.mp4', '.mov'))])
    params = ProcessingParameterModel()
    params.tracking_parameters_model.num_processes = max(1, min(cams, (os.cpu_count() or 2) - 1))
    params.post_processing_parameters_model.framerate = fps
    bw = params.post_processing_parameters_model.butterworth_filter_parameters
    bw.sampling_rate = fps
    bw.cutoff_frequency = min(bw.cutoff_frequency, 0.4 * fps)  # under half the frame rate, or the filter can't be made
    info = RecordingInfoModel(recording_folder_path=rec, active_tracker='mediapipe')
    t = time.time()
    process_recording_headless(recording_path=rec, path_to_camera_calibration_toml=toml, recording_processing_parameter_model=params,
                               recording_info_model=info, run_blender=False, make_jupyter_notebook=False, use_tqdm=False)
    print('DONE', round(time.time() - t, 1), 's at', fps, 'fps,', params.tracking_parameters_model.num_processes, 'processes ->',
          info.output_data_folder_path)
