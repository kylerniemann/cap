import { Immutable, PanelExtensionContext, RenderState, Time, Topic } from "@foxglove/extension";
import {
  ChangeEvent,
  ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

type QueryMode = "quick" | "snippet";
type LogicJoin = "AND" | "OR";
type Operator = "is active" | "is not active" | ">" | "<" | "==" | "!=";

type Condition = {
  id: string;
  join: LogicJoin;
  signal: string;
  operator: Operator;
  value: string;
  durationSec: string;
};

type FrameRecord = {
  frameIndex: number;
  timestampNs: bigint;
  timestamp: Time;
  topic: string;
  schemaName: string;
  signal: string;
};

type SignalInfo = {
  key: string;
  label: string;
  topic: string;
  path: string;
  type: string;
  sampleValue: string;
  aliases: string[];
};

type ResultRow = {
  id: string;
  frameIndex?: number;
  timestampNs: bigint;
  timestamp: Time;
  topic: string;
  signal: string;
  reason: string;
  durationSec?: number;
  recording: string;
  previewTopic?: string;
  previewTimestampNs?: string;
  previewImageDataUrl?: string;
};

type SnippetDefinition = {
  id: string;
  name: string;
  code: string;
  builtin?: boolean;
};

type ScanData = {
  topics: Immutable<Topic[]>;
  frames: FrameRecord[];
  signals: SignalInfo[];
  recordingName: string;
  indexPath: string;
  cameraTopics: string[];
};

type PersistedState = {
  conditions?: Condition[];
  queryMode?: QueryMode;
  savedSnippets?: SnippetDefinition[];
  selectedSnippetId?: string;
  snippetDraft?: string;
  snippetName?: string;
  cameraTopic?: string;
};

type PanelState = {
  topics?: Immutable<Topic[]>;
  currentTime?: Time;
  endTime?: Time;
  colorScheme?: RenderState["colorScheme"];
};

type SceneMetaFile = {
  recordingName?: string;
  topics?: Array<{ name: string; schemaName?: string }>;
  frames?: Array<{
    frameIndex?: number;
    timestampNs: string;
    topic: string;
    schemaName?: string;
    signal?: string;
  }>;
  signals?: SignalInfo[];
  cameraTopics?: string[];
};

const BUILTIN_SNIPPETS: SnippetDefinition[] = [
  {
    id: "builtin-speed-over-threshold",
    name: "Speed Over Threshold",
    builtin: true,
    code: `for (const range of findRanges("/vehicle_speed_kmph.data", ">", 10, 5)) {
  matchRange(range.startNs, range.endNs, "Speed > 10 km/h for 5 seconds", {
    signal: "/vehicle_speed_kmph.data",
    topic: "/vehicle_speed_kmph",
  });
}`,
  },
  {
    id: "builtin-turn-signal",
    name: "Turn Signal Active",
    builtin: true,
    code: `for (const range of findRanges("/vehicle_status.lamp", "!=", 0, 3)) {
  matchRange(range.startNs, range.endNs, "Turn signal active for at least 3 seconds", {
    signal: "/vehicle_status.lamp",
    topic: "/vehicle_status",
  });
}`,
  },
  {
    id: "builtin-custom-loop",
    name: "Custom Loop Example",
    builtin: true,
    code: `for (const sample of signal("/vehicle_speed_kmph.data")) {
  if (Number(sample.value) > 25) {
    match(sample.timestampNs, "High speed sample", {
      signal: "/vehicle_speed_kmph.data",
      topic: "/vehicle_speed_kmph",
    });
  }
}`,
  },
];

function topicSchemaName(topic: { schemaName?: string; datatype?: string }): string {
  return topic.schemaName ?? topic.datatype ?? "";
}

const DEFAULT_CONDITION = (): Condition => ({
  id: makeId(),
  join: "AND",
  signal: "",
  operator: "is active",
  value: "",
  durationSec: "",
});

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function timeToNs(time: Time): bigint {
  return BigInt(time.sec) * 1_000_000_000n + BigInt(time.nsec);
}

function nsToTime(timestampNs: bigint): Time {
  return {
    sec: Number(timestampNs / 1_000_000_000n),
    nsec: Number(timestampNs % 1_000_000_000n),
  };
}

function prettyTimestamp(time?: Time): string {
  if (!time) {
    return "-";
  }
  const ms = Math.floor(time.nsec / 1_000_000)
    .toString()
    .padStart(3, "0");
  return `${time.sec}.${ms}s`;
}

function formatDuration(durationSec?: number): string {
  return durationSec == undefined
    ? "Instant"
    : `${durationSec.toFixed(durationSec >= 10 ? 1 : 2)}s`;
}

function previewResults(scanData: ScanData): ResultRow[] {
  return scanData.frames.slice(0, 200).map((frame) => ({
    id: `frame-${frame.frameIndex}`,
    frameIndex: frame.frameIndex,
    timestampNs: frame.timestampNs,
    timestamp: frame.timestamp,
    topic: frame.topic,
    signal: frame.signal,
    reason: "Indexed frame preview",
    recording: scanData.recordingName,
  }));
}

function parseSceneMeta(
  raw: string,
  topicsFallback: Immutable<Topic[]>,
  indexPath: string,
): ScanData {
  const parsed = JSON.parse(raw) as SceneMetaFile;
  const topics =
    parsed.topics?.map((topic) => ({
      name: topic.name,
      datatype: topic.schemaName ?? "",
      schemaName: topic.schemaName ?? "",
    })) ?? topicsFallback;

  const frames: FrameRecord[] =
    parsed.frames?.map((frame, index) => {
      const timestampNs = BigInt(frame.timestampNs);
      return {
        frameIndex: frame.frameIndex ?? index,
        timestampNs,
        timestamp: nsToTime(timestampNs),
        topic: frame.topic,
        schemaName: frame.schemaName ?? "",
        signal: frame.signal ?? frame.topic,
      };
    }) ?? [];

  return {
    topics,
    frames,
    signals: parsed.signals ?? [],
    recordingName: parsed.recordingName ?? "Matched recording",
    indexPath,
    cameraTopics: parsed.cameraTopics ?? [],
  };
}

function inputStyle(
  surfaceMode: "dark" | "light",
  border: string,
  text: string,
): React.CSSProperties {
  return {
    width: "100%",
    borderRadius: 4,
    border: `1px solid ${border}`,
    padding: "6px 8px",
    background: surfaceMode === "dark" ? "#1f2430" : "#ffffff",
    color: text,
    fontSize: 12,
    minHeight: 30,
    boxSizing: "border-box",
  };
}

function smallButtonStyle(border: string, background: string, text: string): React.CSSProperties {
  return {
    border: `1px solid ${border}`,
    background,
    color: text,
    borderRadius: 4,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

const cellStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 12,
  verticalAlign: "top",
};

function headerStyle(border: string, muted: string): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "6px 8px",
    fontSize: 11,
    color: muted,
    borderBottom: `1px solid ${border}`,
    fontWeight: 600,
  };
}

function SceneSearchPanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const initialState = (context.initialState as PersistedState | undefined) ?? {};
  const importInputRef = useRef<HTMLInputElement>(null);
  const [panelState, setPanelState] = useState<PanelState>({});
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [queryMode, setQueryMode] = useState<QueryMode>(initialState.queryMode ?? "quick");
  const [conditions, setConditions] = useState(
    initialState.conditions && initialState.conditions.length > 0
      ? initialState.conditions
      : [DEFAULT_CONDITION()],
  );
  const [helperStatus, setHelperStatus] = useState("Waiting for Foxglove topics...");
  const [scanData, setScanData] = useState<ScanData | undefined>();
  const [results, setResults] = useState<ResultRow[]>([]);
  const [matchedIndexName, setMatchedIndexName] = useState("");
  const [savedSnippets, setSavedSnippets] = useState(initialState.savedSnippets ?? []);
  const [selectedSnippetId, setSelectedSnippetId] = useState(
    initialState.selectedSnippetId ?? BUILTIN_SNIPPETS[0]!.id,
  );
  const [snippetName, setSnippetName] = useState(
    initialState.snippetName ?? BUILTIN_SNIPPETS[0]!.name,
  );
  const [snippetDraft, setSnippetDraft] = useState(
    initialState.snippetDraft ?? BUILTIN_SNIPPETS[0]!.code,
  );
  const [cameraTopic, setCameraTopic] = useState(initialState.cameraTopic ?? "");

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setPanelState((prev) => ({
        topics: renderState.topics ?? prev.topics,
        currentTime: renderState.currentTime ?? prev.currentTime,
        endTime: renderState.endTime ?? prev.endTime,
        colorScheme: renderState.colorScheme ?? prev.colorScheme,
      }));
    };

    context.watch("topics");
    context.watch("currentTime");
    context.watch("endTime");
    context.watch("colorScheme");
  }, [context]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  useEffect(() => {
    context.saveState({
      conditions,
      queryMode,
      savedSnippets,
      selectedSnippetId,
      snippetDraft,
      snippetName,
      cameraTopic,
    });
  }, [
    cameraTopic,
    conditions,
    context,
    queryMode,
    savedSnippets,
    selectedSnippetId,
    snippetDraft,
    snippetName,
  ]);

  const topics = useMemo(() => panelState.topics ?? [], [panelState.topics]);
  const topicSignature = useMemo(
    () =>
      JSON.stringify(
        [...topics]
          .map((topic) => ({ name: topic.name, schemaName: topicSchemaName(topic) }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      ),
    [topics],
  );
  const allSnippets = useMemo(() => [...BUILTIN_SNIPPETS, ...savedSnippets], [savedSnippets]);
  const signals = scanData?.signals ?? [];
  const recordingSummary = scanData
    ? `${scanData.topics.length} topics, ${signals.length} signals, ${scanData.cameraTopics.length} cameras`
    : `${topics.length} topics detected`;

  useEffect(() => {
    if (topics.length === 0) {
      return;
    }
    setHelperStatus("Matching the opened recording against the local helper...");

    let cancelled = false;
    const load = async () => {
      try {
        const matchResponse = await fetch("http://127.0.0.1:8765/match", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            topics: topics.map((topic) => ({
              name: topic.name,
              schemaName: topicSchemaName(topic),
            })),
          }),
        });

        const matchBody = (await matchResponse.json()) as {
          indexName?: string;
          indexPath?: string;
          recordingName?: string;
          message?: string;
        };

        if (!matchResponse.ok || !matchBody.indexPath || !matchBody.indexName) {
          setHelperStatus(
            matchBody.message ??
              "No matching indexed recording found. Start the local helper and check supported formats.",
          );
          return;
        }

        const metaResponse = await fetch(
          `http://127.0.0.1:8765/meta?path=${encodeURIComponent(matchBody.indexPath)}`,
        );
        if (!metaResponse.ok) {
          setHelperStatus("Matched the recording, but could not load its metadata.");
          return;
        }

        const raw = await metaResponse.text();
        if (cancelled) {
          return;
        }

        const parsed = parseSceneMeta(raw, topics, matchBody.indexPath);
        setScanData(parsed);
        setMatchedIndexName(matchBody.indexName);
        setResults(previewResults(parsed));
        setHelperStatus(
          `Loaded ${parsed.signals.length} signals from ${matchBody.recordingName ?? "matched recording"}.`,
        );
        setConditions((prev) => {
          if (prev[0]?.signal !== "" || !parsed.signals[0]) {
            return prev;
          }
          return prev.map((condition, index) =>
            index === 0 ? { ...condition, signal: parsed.signals[0]!.key } : condition,
          );
        });
        setCameraTopic((prev) => {
          if (prev && parsed.cameraTopics.includes(prev)) {
            return prev;
          }
          return parsed.cameraTopics[0] ?? "";
        });
      } catch {
        setHelperStatus("Local helper is not running. Start the companion helper on this machine.");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [topicSignature, topics]);

  function updateCondition(id: string, patch: Partial<Condition>): void {
    setConditions((prev) =>
      prev.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    );
  }

  function removeCondition(id: string): void {
    setConditions((prev) =>
      prev.length === 1 ? prev : prev.filter((condition) => condition.id !== id),
    );
  }

  async function parseResponseRows(response: Response): Promise<ResultRow[]> {
    const body = (await response.json()) as {
      error?: string;
      results?: Array<
        Omit<ResultRow, "timestampNs" | "timestamp"> & {
          timestampNs: string;
          timestamp: Time;
        }
      >;
    };
    if (!response.ok || !body.results) {
      throw new Error(body.error ?? "Request failed");
    }
    return body.results.map((row) => ({
      ...row,
      timestampNs: BigInt(row.timestampNs),
      timestamp: row.timestamp,
    }));
  }

  function runQuickSearch(): void {
    if (!scanData) {
      setHelperStatus("No historical index is loaded yet.");
      return;
    }
    setHelperStatus("Running quick search in the local helper...");
    const endTimeNs = panelState.endTime ? timeToNs(panelState.endTime).toString() : undefined;
    void fetch("http://127.0.0.1:8765/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        indexPath: scanData.indexPath,
        conditions,
        endTimeNs,
        cameraTopic,
      }),
    })
      .then(parseResponseRows)
      .then((nextResults) => {
        setResults(nextResults);
        setHelperStatus(`Search complete. Found ${nextResults.length} result rows.`);
      })
      .catch((error: unknown) => {
        setHelperStatus(
          error instanceof Error ? error.message : "Quick search failed in the local helper.",
        );
      });
  }

  function runSnippetSearch(): void {
    if (!scanData) {
      setHelperStatus("No historical index is loaded yet.");
      return;
    }
    setHelperStatus("Running snippet search in the local helper...");
    void fetch("http://127.0.0.1:8765/snippet-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        indexPath: scanData.indexPath,
        snippet: snippetDraft,
        cameraTopic,
      }),
    })
      .then(parseResponseRows)
      .then((nextResults) => {
        setResults(nextResults);
        setHelperStatus(`Snippet complete. Found ${nextResults.length} result rows.`);
      })
      .catch((error: unknown) => {
        setHelperStatus(
          error instanceof Error ? error.message : "Snippet search failed in the local helper.",
        );
      });
  }

  function saveSnippet(): void {
    const trimmedName = snippetName.trim() || "Untitled Snippet";
    setSavedSnippets((prev) => {
      const existing = prev.find((item) => item.id === selectedSnippetId);
      if (existing) {
        return prev.map((item) =>
          item.id === selectedSnippetId ? { ...item, name: trimmedName, code: snippetDraft } : item,
        );
      }
      const next = { id: makeId(), name: trimmedName, code: snippetDraft };
      setSelectedSnippetId(next.id);
      return [...prev, next];
    });
    setHelperStatus(`Saved snippet "${trimmedName}".`);
  }

  function newSnippet(): void {
    setSelectedSnippetId("new");
    setSnippetName("New Snippet");
    setSnippetDraft(
      `const info = timeline();\nmatch(info.startNs, "Replace this with your own query");`,
    );
    setQueryMode("snippet");
  }

  function loadSnippet(snippetId: string): void {
    setSelectedSnippetId(snippetId);
    const snippet = allSnippets.find((item) => item.id === snippetId);
    if (snippet) {
      setSnippetName(snippet.name);
      setSnippetDraft(snippet.code);
      setQueryMode("snippet");
    }
  }

  function exportSnippets(): void {
    const blob = new Blob([JSON.stringify(savedSnippets, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scene-search-snippets.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importSnippets(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = typeof reader.result === "string" ? reader.result : "[]";
        const parsed = JSON.parse(raw) as SnippetDefinition[];
        const normalized = parsed
          .filter((item) => typeof item.name === "string" && typeof item.code === "string")
          .map((item) => ({
            id: item.id && !item.id.startsWith("builtin-") ? item.id : makeId(),
            name: item.name,
            code: item.code,
          }));
        setSavedSnippets((prev) => [...prev, ...normalized]);
        setHelperStatus(`Imported ${normalized.length} snippets.`);
      } catch {
        setHelperStatus("Could not import snippets from that file.");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  function removeCurrentSnippet(): void {
    const current = savedSnippets.find((item) => item.id === selectedSnippetId);
    if (!current) {
      return;
    }
    setSavedSnippets((prev) => prev.filter((item) => item.id !== selectedSnippetId));
    loadSnippet(BUILTIN_SNIPPETS[0]!.id);
  }

  const isDark = panelState.colorScheme === "dark";
  const page = isDark ? "#11151c" : "#f7f8fa";
  const surface = isDark ? "#1b2029" : "#ffffff";
  const text = isDark ? "#eef2f7" : "#1f2937";
  const muted = isDark ? "#a9b4c2" : "#6b7280";
  const border = isDark ? "#343b48" : "#d7dce3";
  const button = isDark ? "#232936" : "#ffffff";
  const selected = isDark ? "#2b3340" : "#eef2f7";
  const surfaceMode = isDark ? "dark" : "light";
  const signalListId = "scene-search-signals";

  return (
    <div
      style={{
        minHeight: "100%",
        background: page,
        color: text,
        padding: 10,
        fontFamily: "sans-serif",
        boxSizing: "border-box",
      }}
    >
      <datalist id={signalListId}>
        {signals.map((signal) => (
          <option key={signal.key} value={signal.key}>
            {signal.topic}
          </option>
        ))}
      </datalist>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={importSnippets}
      />

      <div
        style={{
          background: surface,
          border: `1px solid ${border}`,
          borderRadius: 6,
          padding: 10,
          display: "grid",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 8,
            alignItems: "start",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Scene Search</div>
            <div style={{ color: muted, fontSize: 11, marginTop: 2 }}>{helperStatus}</div>
            <div style={{ color: muted, fontSize: 11, marginTop: 2 }}>
              {matchedIndexName ? `${matchedIndexName} • ` : ""}
              {recordingSummary} • current {prettyTimestamp(panelState.currentTime)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => {
                setQueryMode("quick");
              }}
              style={{
                ...smallButtonStyle(border, queryMode === "quick" ? selected : button, text),
                fontWeight: queryMode === "quick" ? 600 : 500,
              }}
            >
              Quick Filters
            </button>
            <button
              onClick={() => {
                setQueryMode("snippet");
              }}
              style={{
                ...smallButtonStyle(border, queryMode === "snippet" ? selected : button, text),
                fontWeight: queryMode === "snippet" ? 600 : 500,
              }}
            >
              Snippets
            </button>
          </div>
          <div style={{ minWidth: 220 }}>
            <select
              value={cameraTopic}
              onChange={(event) => {
                setCameraTopic(event.target.value);
              }}
              style={inputStyle(surfaceMode, border, text)}
            >
              <option value="">No camera preview</option>
              {scanData?.cameraTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
          </div>
        </div>

        {queryMode === "quick" ? (
          <section
            style={{
              border: `1px solid ${border}`,
              borderRadius: 4,
              padding: 8,
              display: "grid",
              gap: 8,
            }}
          >
            {conditions.map((condition, index) => (
              <div
                key={condition.id}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    index > 0 ? "68px 2.2fr 1fr 0.9fr 0.9fr auto" : "2.2fr 1fr 0.9fr 0.9fr auto",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {index > 0 ? (
                  <select
                    value={condition.join}
                    onChange={(event) => {
                      updateCondition(condition.id, { join: event.target.value as LogicJoin });
                    }}
                    style={inputStyle(surfaceMode, border, text)}
                  >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                ) : undefined}
                <input
                  list={signalListId}
                  value={condition.signal}
                  onChange={(event) => {
                    updateCondition(condition.id, { signal: event.target.value });
                  }}
                  placeholder="signal path"
                  style={inputStyle(surfaceMode, border, text)}
                />
                <select
                  value={condition.operator}
                  onChange={(event) => {
                    updateCondition(condition.id, { operator: event.target.value as Operator });
                  }}
                  style={inputStyle(surfaceMode, border, text)}
                >
                  {["is active", "is not active", ">", "<", "==", "!="].map((operator) => (
                    <option key={operator} value={operator}>
                      {operator}
                    </option>
                  ))}
                </select>
                <input
                  value={condition.value}
                  disabled={
                    condition.operator === "is active" || condition.operator === "is not active"
                  }
                  onChange={(event) => {
                    updateCondition(condition.id, { value: event.target.value });
                  }}
                  placeholder="value"
                  style={inputStyle(surfaceMode, border, text)}
                />
                <input
                  value={condition.durationSec}
                  onChange={(event) => {
                    updateCondition(condition.id, { durationSec: event.target.value });
                  }}
                  placeholder="sec"
                  style={inputStyle(surfaceMode, border, text)}
                />
                <button
                  onClick={() => {
                    removeCondition(condition.id);
                  }}
                  style={smallButtonStyle(border, button, text)}
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  setConditions((prev) => [...prev, DEFAULT_CONDITION()]);
                }}
                style={smallButtonStyle(border, button, text)}
              >
                Add Condition
              </button>
              <button onClick={runQuickSearch} style={smallButtonStyle(border, button, text)}>
                Run Search
              </button>
            </div>
          </section>
        ) : (
          <section
            style={{
              border: `1px solid ${border}`,
              borderRadius: 4,
              padding: 8,
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr auto auto auto auto auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <select
                value={selectedSnippetId}
                onChange={(event) => {
                  loadSnippet(event.target.value);
                }}
                style={inputStyle(surfaceMode, border, text)}
              >
                {allSnippets.map((snippet) => (
                  <option key={snippet.id} value={snippet.id}>
                    {snippet.builtin === true ? `Example: ${snippet.name}` : snippet.name}
                  </option>
                ))}
              </select>
              <input
                value={snippetName}
                onChange={(event) => {
                  setSnippetName(event.target.value);
                }}
                placeholder="snippet name"
                style={inputStyle(surfaceMode, border, text)}
              />
              <button onClick={newSnippet} style={smallButtonStyle(border, button, text)}>
                New
              </button>
              <button onClick={saveSnippet} style={smallButtonStyle(border, button, text)}>
                Save
              </button>
              <button onClick={runSnippetSearch} style={smallButtonStyle(border, button, text)}>
                Run
              </button>
              <button onClick={exportSnippets} style={smallButtonStyle(border, button, text)}>
                Export
              </button>
              <button
                onClick={() => {
                  importInputRef.current?.click();
                }}
                style={smallButtonStyle(border, button, text)}
              >
                Import
              </button>
            </div>
            <textarea
              value={snippetDraft}
              onChange={(event) => {
                setSnippetDraft(event.target.value);
              }}
              spellCheck={false}
              style={{
                ...inputStyle(surfaceMode, border, text),
                minHeight: 150,
                fontFamily: "Consolas, monospace",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
              <div style={{ color: muted, fontSize: 11 }}>
                Helpers: `timeline()`, `signals()`, `signal(name)`, `signalValue(name, t)`,
                `signalActive(name, t)`, `findRanges(name, op, value, minSec)`, `match(...)`,
                `matchRange(...)`
              </div>
              <button
                onClick={removeCurrentSnippet}
                disabled={!savedSnippets.some((item) => item.id === selectedSnippetId)}
                style={smallButtonStyle(border, button, text)}
              >
                Delete Saved
              </button>
            </div>
          </section>
        )}

        <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead style={{ background: selected }}>
              <tr>
                {["Preview", "Frame", "Timestamp", "Signal", "Reason", "Duration", "Recording"].map(
                  (header) => (
                    <th key={header} style={headerStyle(border, muted)}>
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...cellStyle, color: muted }}>
                    No results yet.
                  </td>
                </tr>
              ) : (
                results.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      context.seekPlayback?.(row.timestamp);
                    }}
                    style={{ cursor: "pointer", borderBottom: `1px solid ${border}` }}
                  >
                    <td style={{ ...cellStyle, width: 104 }}>
                      {row.previewImageDataUrl ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          <img
                            src={row.previewImageDataUrl}
                            alt={row.previewTopic ?? "Camera preview"}
                            style={{
                              width: 96,
                              height: 54,
                              objectFit: "cover",
                              borderRadius: 4,
                              border: `1px solid ${border}`,
                              display: "block",
                            }}
                          />
                          <div style={{ color: muted, fontSize: 10, lineHeight: 1.3 }}>
                            {row.previewTopic}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: muted, fontSize: 11 }}>No preview</div>
                      )}
                    </td>
                    <td style={cellStyle}>{row.frameIndex ?? "Nearest"}</td>
                    <td style={cellStyle}>{prettyTimestamp(row.timestamp)}</td>
                    <td style={cellStyle}>
                      <div>{row.signal}</div>
                      <div style={{ color: muted, fontSize: 11 }}>{row.topic}</div>
                    </td>
                    <td style={cellStyle}>{row.reason}</td>
                    <td style={cellStyle}>{formatDuration(row.durationSec)}</td>
                    <td style={cellStyle}>{row.recording}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function initSceneSearchPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<SceneSearchPanel context={context} />);

  return () => {
    root.unmount();
  };
}
