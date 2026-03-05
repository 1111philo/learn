import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { listAgentLogs } from '@/api/agent-logs';
import { fetchCourses } from '@/api/courses';
import type { AgentLog, CourseListItem } from '@/api/types';

// Token cost per model (USD per token)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'anthropic:claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'anthropic:claude-opus-4-6':   { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'anthropic:claude-haiku-4-5':  { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

const TIME_OPTIONS = [
  { label: 'All time',   ms: null },
  { label: 'Last hour',  ms: 60 * 60 * 1000 },
  { label: 'Last 24h',   ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7 days',ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

function estimateCost(log: AgentLog): number | null {
  if (!log.model_name || log.input_tokens == null || log.output_tokens == null) return null;
  const rates = MODEL_COSTS[log.model_name];
  if (!rates) return null;
  return log.input_tokens * rates.input + log.output_tokens * rates.output;
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function courseLabel(course: CourseListItem): string {
  const desc = course.input_description;
  if (!desc) return course.id.slice(0, 8);
  return desc.length > 48 ? desc.slice(0, 48) + '…' : desc;
}

function AgentLogRow({ log, courseLabel }: { log: AgentLog; courseLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  const cost = estimateCost(log);
  const timestamp = new Date(log.created_at).toLocaleString();
  const slug = `${log.agent_name}-${log.id.slice(0, 8)}`;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex flex-wrap items-center gap-3 px-3 sm:px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        <span className="font-mono text-sm font-medium w-32 sm:w-44 shrink-0 truncate">{log.agent_name}</span>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {log.status}
        </span>

        <span className="text-sm text-muted-foreground shrink-0 hidden sm:block">{timestamp}</span>

        {log.duration_ms != null && (
          <span className="text-sm text-muted-foreground shrink-0 hidden sm:block">
            {log.duration_ms >= 1000 ? `${(log.duration_ms / 1000).toFixed(1)}s` : `${log.duration_ms}ms`}
          </span>
        )}

        {(log.input_tokens != null || log.output_tokens != null) && (
          <span className="text-sm text-muted-foreground shrink-0 hidden md:block">
            in={log.input_tokens ?? '—'} out={log.output_tokens ?? '—'}
          </span>
        )}

        <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[160px] hidden md:block">
          {courseLabel}
        </span>

        {cost != null && (
          <span className="text-sm text-muted-foreground shrink-0 ml-auto hidden sm:block">
            ${cost.toFixed(4)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t divide-y bg-muted/20">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompt</span>
              <button
                onClick={() => download(`${slug}-prompt.txt`, log.prompt)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="h-3 w-3" /> Download
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-background border rounded p-3 max-h-64 overflow-auto">
              {log.prompt}
            </pre>
          </div>

          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response</span>
              {log.output && (
                <button
                  onClick={() => download(`${slug}-response.txt`, log.output!)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              )}
            </div>
            <pre className="whitespace-pre-wrap text-xs font-mono bg-background border rounded p-3 max-h-64 overflow-auto">
              {log.output ?? <span className="italic text-muted-foreground">no output</span>}
            </pre>
          </div>

          <div className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {log.model_name && <span>Model: <span className="font-mono text-foreground">{log.model_name}</span></span>}
            <span>Course: <span className="font-mono text-foreground">{log.course_instance_id.slice(0, 8)}</span></span>
            <span>Time: <span className="text-foreground">{timestamp}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentLogsPage() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [courseFilter, setCourseFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([listAgentLogs(), fetchCourses()])
      .then(([l, c]) => { setLogs(l); setCourses(c); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Build lookup: course_id -> label
  const courseMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of courses) m[c.id] = courseLabel(c);
    return m;
  }, [courses]);

  // Unique filter options derived from data
  const courseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const log of logs) {
      if (!seen.has(log.course_instance_id)) {
        seen.set(log.course_instance_id, courseMap[log.course_instance_id] ?? log.course_instance_id.slice(0, 8));
      }
    }
    return Array.from(seen.entries()); // [id, label]
  }, [logs, courseMap]);

  const agentOptions = useMemo(() => {
    return [...new Set(logs.map((l) => l.agent_name))].sort();
  }, [logs]);

  // Apply filters
  const filtered = useMemo(() => {
    const cutoff = timeFilter ? Date.now() - timeFilter : null;
    return logs.filter((log) => {
      if (courseFilter && log.course_instance_id !== courseFilter) return false;
      if (agentFilter && log.agent_name !== agentFilter) return false;
      if (cutoff && new Date(log.created_at).getTime() < cutoff) return false;
      return true;
    });
  }, [logs, courseFilter, agentFilter, timeFilter]);

  const totalCost = useMemo(() => {
    return filtered.reduce((sum, log) => sum + (estimateCost(log) ?? 0), 0);
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive py-8">{error}</p>;
  }

  const isFiltered = courseFilter || agentFilter || timeFilter !== null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Agent Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isFiltered ? `${filtered.length} of ${logs.length}` : logs.length} calls
          </p>
        </div>
        {filtered.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {isFiltered ? 'Filtered cost: ' : 'Total cost: '}
            <span className="font-medium text-foreground">${totalCost.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Filters */}
      {logs.length > 0 && (
        <div className="flex flex-wrap gap-3 items-center">
          {/* Course filter */}
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="text-sm border rounded px-2 py-1.5 bg-background text-foreground"
          >
            <option value="">All courses</option>
            {courseOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>

          {/* Agent filter */}
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="text-sm border rounded px-2 py-1.5 bg-background text-foreground"
          >
            <option value="">All agents</option>
            {agentOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          {/* Time filter */}
          <select
            value={timeFilter ?? ''}
            onChange={(e) => setTimeFilter(e.target.value ? Number(e.target.value) : null)}
            className="text-sm border rounded px-2 py-1.5 bg-background text-foreground"
          >
            {TIME_OPTIONS.map(({ label, ms }) => (
              <option key={label} value={ms ?? ''}>{label}</option>
            ))}
          </select>

          {/* Clear filters */}
          {isFiltered && (
            <button
              onClick={() => { setCourseFilter(''); setAgentFilter(''); setTimeFilter(null); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Log list */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          {logs.length === 0 ? 'No agent calls logged yet.' : 'No results match the current filters.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => (
            <AgentLogRow
              key={log.id}
              log={log}
              courseLabel={courseMap[log.course_instance_id] ?? log.course_instance_id.slice(0, 8)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
