type SerializableMessage = {
  frameIndex: number;
  timestampSec: number;
  topic: string;
  signal: string;
  message: unknown;
};

type SerializableSignalSample = {
  timestampSec: number;
  value: unknown;
  topic: string;
  signal: string;
};

export type PythonDataset = {
  frames: SerializableMessage[];
  messagesByTopic: Record<string, SerializableMessage[]>;
  signals: Record<string, SerializableSignalSample[]>;
  timeline: number[];
};

export type PythonMatch = {
  kind: "instant" | "frame" | "range";
  frameIndex?: number;
  timestampSec?: number;
  startSec?: number;
  endSec?: number;
  reason: string;
};

type PythonWorkerResponse =
  | { type: "ready" }
  | { type: "result"; matches: PythonMatch[] }
  | { type: "error"; error: string };

let workerPromise: Promise<Worker> | undefined;

async function createPythonWorker(): Promise<Worker> {
  if (workerPromise) {
    return await workerPromise;
  }

  const workerSource = `
    let pyodideReady = null;

    function ensurePyodide() {
      if (!pyodideReady) {
        pyodideReady = (async () => {
          importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js");
          self.pyodide = await loadPyodide();
          postMessage({ type: "ready" });
          return self.pyodide;
        })();
      }
      return pyodideReady;
    }

    function cloneValue(value) {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return String(value);
      }
    }

    function createSceneApi(dataset, matches) {
      const frameByIndex = new Map(dataset.frames.map((frame) => [frame.frameIndex, frame]));
      const signalMap = new Map(Object.entries(dataset.signals));
      const topicMap = new Map(Object.entries(dataset.messagesByTopic));

      function nearestFrame(timestampSec) {
        const frames = dataset.frames;
        if (frames.length === 0) {
          return null;
        }
        let low = 0;
        let high = frames.length - 1;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          if (frames[mid].timestampSec < timestampSec) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
        const exact = frames[low];
        const prev = frames[Math.max(0, low - 1)];
        if (Math.abs(prev.timestampSec - timestampSec) < Math.abs(exact.timestampSec - timestampSec)) {
          return prev;
        }
        return exact;
      }

      function signalValue(name, timestampSec) {
        const samples = signalMap.get(name) ?? [];
        let latest = undefined;
        for (const sample of samples) {
          if (sample.timestampSec > timestampSec) {
            break;
          }
          latest = sample.value;
        }
        return latest;
      }

      function signalActive(name, timestampSec) {
        const value = signalValue(name, timestampSec);
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "number") {
          return value !== 0;
        }
        if (typeof value === "string") {
          return ["true", "on", "active", "1", "yes", "enabled"].includes(value.toLowerCase());
        }
        return Boolean(value);
      }

      return {
        timeline_json() {
          return JSON.stringify(dataset.timeline);
        },
        get_signal_json(name) {
          return JSON.stringify(signalMap.get(name) ?? []);
        },
        topic_messages_json(topic) {
          return JSON.stringify(topicMap.get(topic) ?? []);
        },
        signal_active(name, timestampSec) {
          return signalActive(String(name), Number(timestampSec));
        },
        signal_value_json(name, timestampSec) {
          return JSON.stringify(cloneValue(signalValue(String(name), Number(timestampSec))));
        },
        objects_json(timestampSec) {
          const frame = nearestFrame(Number(timestampSec));
          if (!frame) {
            return JSON.stringify([]);
          }
          const candidates = dataset.frames.filter((item) => {
            return (
              Math.abs(item.timestampSec - frame.timestampSec) < 0.05 &&
              /object|track|detection/i.test(item.topic + " " + item.signal)
            );
          });
          return JSON.stringify(candidates);
        },
        lidar_points_json(timestampSec) {
          const frame = nearestFrame(Number(timestampSec));
          if (!frame) {
            return 0;
          }
          const cloud = dataset.frames.find((item) => {
            return Math.abs(item.timestampSec - frame.timestampSec) < 0.05 && /lidar|point/i.test(item.topic + " " + item.signal);
          });
          if (!cloud || typeof cloud.message !== "object" || cloud.message == null) {
            return 0;
          }
          const msg = cloud.message;
          if (Array.isArray(msg)) {
            return msg.length;
          }
          if (typeof msg === "object" && "points" in msg && Array.isArray(msg.points)) {
            return msg.points.length;
          }
          if (typeof msg === "object" && "width" in msg && "height" in msg) {
            return Number(msg.width) * Number(msg.height);
          }
          return 0;
        },
        event_within(name, startSec, withinSec) {
          const samples = signalMap.get(String(name)) ?? [];
          const start = Number(startSec);
          const end = start + Number(withinSec);
          return samples.some((sample) => sample.timestampSec >= start && sample.timestampSec <= end);
        },
        match(timestampSec, reason) {
          matches.push({ kind: "instant", timestampSec: Number(timestampSec), reason: String(reason ?? "") });
        },
        match_frame(frameIndex, timestampSec, reason) {
          const frame = frameByIndex.get(Number(frameIndex));
          matches.push({
            kind: "frame",
            frameIndex: Number(frameIndex),
            timestampSec: timestampSec == null ? frame?.timestampSec : Number(timestampSec),
            reason: String(reason ?? ""),
          });
        },
        match_range(startSec, endSec, reason) {
          matches.push({
            kind: "range",
            startSec: Number(startSec),
            endSec: Number(endSec),
            reason: String(reason ?? ""),
          });
        },
      };
    }

    const PYTHON_PRELUDE = \`
import json
from js import scene_api

class Segment:
    def __init__(self, start, end):
        self.start = start
        self.end = end

def timeline():
    return json.loads(scene_api.timeline_json())

def get_signal(name):
    return json.loads(scene_api.get_signal_json(name))

def signal_active(name, t):
    return bool(scene_api.signal_active(name, t))

def signal_value(name, t):
    return json.loads(scene_api.signal_value_json(name, t))

def topic_messages(topic):
    return json.loads(scene_api.topic_messages_json(topic))

def objects(t):
    return json.loads(scene_api.objects_json(t))

def lidar_points(t):
    return scene_api.lidar_points_json(t)

def match(timestamp, reason=""):
    scene_api.match(timestamp, reason)

def match_frame(frame_index, timestamp=None, reason=""):
    scene_api.match_frame(frame_index, timestamp, reason)

def match_range(start, end, reason=""):
    scene_api.match_range(start, end, reason)

def event_within(name, start, within):
    return bool(scene_api.event_within(name, start, within))

def duration_where(predicate, min_duration):
    stamps = timeline()
    segments = []
    start = None
    for idx, t in enumerate(stamps):
        is_true = bool(predicate(t))
        if is_true and start is None:
            start = t
        next_t = stamps[idx + 1] if idx + 1 < len(stamps) else t
        if start is not None and (not is_true or idx == len(stamps) - 1):
            end = next_t if is_true else t
            if (end - start) >= min_duration:
                segments.append(Segment(start, end))
            start = None
    return segments
\`;

    self.onmessage = async (event) => {
      if (event.data?.type !== "run") {
        return;
      }
      try {
        const pyodide = await ensurePyodide();
        const matches = [];
        const api = createSceneApi(event.data.dataset, matches);
        self.scene_api = api;
        pyodide.globals.set("scene_api", api);
        await pyodide.runPythonAsync(PYTHON_PRELUDE + "\\n" + event.data.snippet);
        postMessage({ type: "result", matches });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        postMessage({ type: "error", error: message });
      }
    };
  `;

  workerPromise = new Promise((resolve) => {
    const blob = new Blob([workerSource], { type: "text/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    resolve(worker);
  });

  return await workerPromise;
}

export async function runPythonSceneSnippet(
  snippet: string,
  dataset: PythonDataset,
): Promise<PythonMatch[]> {
  const worker = await createPythonWorker();

  return await new Promise<PythonMatch[]>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Python snippet timed out after 20 seconds."));
    }, 20_000);

    const handleMessage = (event: MessageEvent<PythonWorkerResponse>) => {
      if (event.data.type === "ready") {
        return;
      }
      if (event.data.type === "result") {
        cleanup();
        resolve(event.data.matches);
        return;
      }
      cleanup();
      reject(new Error(event.data.error));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener("message", handleMessage as EventListener);
    };

    worker.addEventListener("message", handleMessage as EventListener);
    worker.postMessage({ type: "run", snippet, dataset });
  });
}
