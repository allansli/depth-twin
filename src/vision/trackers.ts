import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { cachedBytes } from '../lib/cacheAsset';
import { HAND_MODEL_URL, POSE_MODEL_URL } from '../lib/constants';

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;

function visionFileset(): ReturnType<typeof FilesetResolver.forVisionTasks> {
  if (!filesetPromise) {
    const base = new URL(`${import.meta.env.BASE_URL}mediapipe`, window.location.href).href;
    // Classic script build. The *_module_internal.js file uses import.meta, and
    // Tasks Vision inserts the loader with a plain <script>, which cannot run it.
    filesetPromise = FilesetResolver.forVisionTasks(base);
  }
  return filesetPromise;
}

export interface HandTracker {
  landmarker: HandLandmarker;
  delegate: 'GPU' | 'CPU';
}

export async function createHandTracker(canvas: HTMLCanvasElement): Promise<HandTracker> {
  const fileset = await visionFileset();
  const bytes = await cachedBytes(HAND_MODEL_URL);
  try {
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: bytes.slice(), delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      canvas,
    });
    return { landmarker, delegate: 'GPU' };
  } catch {
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: bytes.slice(), delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    return { landmarker, delegate: 'CPU' };
  }
}

export interface PoseTracker {
  landmarker: PoseLandmarker;
  delegate: 'GPU' | 'CPU';
}

export async function createPoseTracker(canvas: HTMLCanvasElement): Promise<PoseTracker> {
  const fileset = await visionFileset();
  const bytes = await cachedBytes(POSE_MODEL_URL);
  const shared = {
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    outputSegmentationMasks: false,
  };
  try {
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...shared,
      baseOptions: { modelAssetBuffer: bytes.slice(), delegate: 'GPU' },
      canvas,
    });
    return { landmarker, delegate: 'GPU' };
  } catch {
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...shared,
      baseOptions: { modelAssetBuffer: bytes.slice(), delegate: 'CPU' },
    });
    return { landmarker, delegate: 'CPU' };
  }
}
