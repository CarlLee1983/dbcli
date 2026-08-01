import React from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  Database,
  Table,
  Info,
  Download,
  Clock,
  Rows,
  TriangleAlert,
  ShieldAlert,
} from 'lucide-react'
import { formatValue, type ValueFormat } from './lib/format-value'
import { resolveKpi } from './lib/resolve-kpi'
import { deriveColumns } from './lib/derive-columns'

interface KPI {
  label: string
  value_column: string
  format?: ValueFormat
}

interface Chart {
  type: string
  title?: string
  x: string
  y: string[]
}

declare global {
  interface Window {
    __DBCLI_PAYLOAD__?: {
      meta: {
        name: string
        description?: string
        visual?: {
          title?: string
          kpis?: KPI[]
          charts?: Chart[]
        }
      }
      rows: Array<Record<string, unknown>>
      appliedLimit?: { truncated: boolean; limitApplied: number }
      securityNotification?: string
    }
  }
}

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4']
const RENDERABLE_CHART_TYPES = ['line', 'bar', 'area', 'pie']

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: any[]
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-slate-200 shadow-lg rounded-lg p-3 text-sm">
        <p className="font-semibold text-slate-900 mb-1 border-b border-slate-100 pb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-3 py-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-500">{entry.name}:</span>
            <span className="font-mono font-medium text-slate-900">{formatValue(entry.value)}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function App() {
  const payload = window.__DBCLI_PAYLOAD__ || {
    meta: { name: 'Report Preview', visual: { title: 'Operational Overview' } },
    rows: [],
  }

  const meta = payload.meta || { name: 'Database Report', key: 'default' }
  const rows = payload.rows || []
  const visual = meta.visual || {}
  const appliedLimit = payload.appliedLimit

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary-600 p-1.5 rounded-lg">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-none">
              {visual.title || meta.name}
            </h1>
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mt-1">
              dbcli Interactive Intelligence
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full text-slate-600 text-xs font-medium">
            <Rows className="w-3.5 h-3.5" />
            {rows.length} Records
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-3 py-1.5 text-slate-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Export PDF
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 lg:p-8 space-y-8">
        {appliedLimit?.truncated && (
          <div
            role="alert"
            className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-950"
          >
            <TriangleAlert className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600" />
            <p className="text-sm leading-relaxed font-medium">
              Result truncated at {appliedLimit.limitApplied} records. Charts, KPIs, and the raw
              table below use incomplete data; rerun with --no-limit or an explicit --limit.
            </p>
          </div>
        )}

        {payload.securityNotification && (
          <div
            role="status"
            className="flex items-start gap-3 p-4 bg-sky-50 border border-sky-200 rounded-xl text-sky-950"
          >
            <ShieldAlert className="w-5 h-5 mt-0.5 flex-shrink-0 text-sky-600" />
            <p className="text-sm leading-relaxed">{payload.securityNotification}</p>
          </div>
        )}

        {/* Description Header */}
        {meta.description && (
          <div className="flex items-start gap-3 p-4 bg-primary-50 border border-primary-100 rounded-xl text-primary-900">
            <Info className="w-5 h-5 mt-0.5 flex-shrink-0 text-primary-600" />
            <p className="text-sm leading-relaxed">{meta.description}</p>
          </div>
        )}

        {/* KPIs */}
        {visual.kpis && visual.kpis.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {visual.kpis.map((kpi: KPI, idx: number) => (
              <div key={idx} className="card p-6 border-l-4 border-l-primary-500 hover:shadow-md">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                  {kpi.label}
                </p>
                <p className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {resolveKpi(rows, kpi)}
                </p>
                <div className="mt-4 flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full w-fit">
                  <Clock className="w-3 h-3" />
                  REAL-TIME SNAPSHOT
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        {visual.charts && visual.charts.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {visual.charts.map((chart: Chart, idx: number) => (
              <div key={idx} className="card p-6 flex flex-col h-[450px]">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <div className="w-1.5 h-6 bg-primary-500 rounded-full" />
                    {chart.title || `Data Insight ${idx + 1}`}
                  </h3>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                    <div className="w-2 h-2 rounded-full bg-slate-200" />
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  {RENDERABLE_CHART_TYPES.includes(chart.type) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      {chart.type === 'line' ? (
                        <LineChart data={rows} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey={chart.x}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                            dy={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                          />
                          <Tooltip
                            content={<CustomTooltip />}
                            cursor={{ stroke: '#e2e8f0', strokeWidth: 2 }}
                          />
                          <Legend
                            verticalAlign="top"
                            align="right"
                            iconType="circle"
                            wrapperStyle={{ paddingBottom: 20, fontSize: 12, fontWeight: 500 }}
                          />
                          {chart.y.map((y: string, i: number) => (
                            <Line
                              key={y}
                              type="monotone"
                              dataKey={y}
                              stroke={COLORS[i % COLORS.length]}
                              strokeWidth={3}
                              dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                              activeDot={{ r: 6, strokeWidth: 0 }}
                              animationDuration={1000}
                            />
                          ))}
                        </LineChart>
                      ) : chart.type === 'bar' ? (
                        <BarChart data={rows} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey={chart.x}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                            dy={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                          />
                          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                          <Legend
                            verticalAlign="top"
                            align="right"
                            iconType="circle"
                            wrapperStyle={{ paddingBottom: 20, fontSize: 12, fontWeight: 500 }}
                          />
                          {chart.y.map((y: string, i: number) => (
                            <Bar
                              key={y}
                              dataKey={y}
                              fill={COLORS[i % COLORS.length]}
                              radius={[4, 4, 0, 0]}
                              barSize={32}
                            />
                          ))}
                        </BarChart>
                      ) : chart.type === 'area' ? (
                        <AreaChart data={rows} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                          <defs>
                            {chart.y.map((y: string, i: number) => (
                              <linearGradient
                                key={`grad-${y}`}
                                id={`color-${y}`}
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="5%"
                                  stopColor={COLORS[i % COLORS.length]}
                                  stopOpacity={0.3}
                                />
                                <stop
                                  offset="95%"
                                  stopColor={COLORS[i % COLORS.length]}
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey={chart.x}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                            dy={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend
                            verticalAlign="top"
                            align="right"
                            iconType="circle"
                            wrapperStyle={{ paddingBottom: 20, fontSize: 12, fontWeight: 500 }}
                          />
                          {chart.y.map((y: string, i: number) => (
                            <Area
                              key={y}
                              type="monotone"
                              dataKey={y}
                              stroke={COLORS[i % COLORS.length]}
                              strokeWidth={3}
                              fillOpacity={1}
                              fill={`url(#color-${y})`}
                            />
                          ))}
                        </AreaChart>
                      ) : (
                        <PieChart>
                          <Pie
                            data={rows}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={120}
                            paddingAngle={8}
                            dataKey={chart.y[0]}
                            nameKey={chart.x}
                            stroke="none"
                          >
                            {rows.map((_: unknown, index: number) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend iconType="circle" verticalAlign="bottom" />
                        </PieChart>
                      )}
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-slate-400">
                      Unsupported chart type: {chart.type}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Raw Table */}
        <section className="card">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                Raw Result Set
              </h2>
            </div>
            <span className="text-[10px] font-bold text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
              READ-ONLY
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  {deriveColumns(rows).map((col) => (
                    <th
                      key={col}
                      className="px-6 py-4 font-bold text-slate-500 text-[11px] uppercase tracking-widest bg-slate-50/30"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((row: unknown, i: number) => (
                  <tr key={i} className="hover:bg-primary-50/30 transition-colors group">
                    {Object.values(row as Record<string, unknown>).map((val, j) => (
                      <td
                        key={j}
                        className="px-6 py-4 whitespace-nowrap text-slate-600 font-medium group-hover:text-primary-700 transition-colors"
                      >
                        {val === null ? (
                          <span className="text-slate-300 italic">null</span>
                        ) : (
                          String(val)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="text-center py-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full shadow-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Generated via dbcli engine
            </span>
          </div>
          <p className="mt-4 text-slate-400 text-[10px] font-medium tracking-tight">
            &copy; 2026 Dbcli Intelligence Platform &bull; Standalone Secured Asset
          </p>
        </footer>
      </main>
    </div>
  )
}
