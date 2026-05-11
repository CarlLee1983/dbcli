import React from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Database, Table, BarChart3, Info } from 'lucide-react';

declare global {
  interface Window {
    __DBCLI_PAYLOAD__?: {
      meta: {
        name: string;
        description?: string;
        visual?: {
          title?: string;
          kpis?: Array<{ label: string; value_column: string; format?: string }>;
          charts?: Array<{ type: string; title?: string; x: string; y: string[] }>;
        };
      };
      rows: Array<Record<string, any>>;
    };
  }
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

const formatValue = (val: any, format?: string) => {
  if (typeof val !== 'number') return val;
  if (format === 'currency') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  if (format === 'percent') return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2 }).format(val / 100);
  if (format === 'number') return new Intl.NumberFormat('en-US').format(val);
  return val;
};

export default function App() {
  const payload = window.__DBCLI_PAYLOAD__ || {
    meta: { name: 'Demo Dashboard', visual: { title: 'No Data' } },
    rows: []
  };

  const meta = payload.meta || { name: 'Report', key: 'default' };
  const rows = payload.rows || [];
  const visual = meta.visual || {};

  return (
    <div className="min-h-screen p-6 space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="text-primary" />
            {visual.title || meta.name}
          </h1>
          {meta.description && <p className="text-slate-500 mt-1">{meta.description}</p>}
        </div>
        <div className="text-xs font-mono bg-slate-100 px-3 py-1 rounded-full text-slate-500">
          {rows.length} rows returned
        </div>
      </header>

      {/* KPIs */}
      {visual.kpis && visual.kpis.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {visual.kpis.map((kpi, idx) => (
            <div key={idx} className="bg-white p-6 rounded-xl border border-border shadow-sm">
              <p className="text-sm text-slate-500 font-medium">{kpi.label}</p>
              <p className="text-2xl font-bold mt-2">
                {formatValue(rows[0]?.[kpi.value_column], kpi.format)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {visual.charts && visual.charts.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {visual.charts.map((chart, idx) => (
            <div key={idx} className="bg-white p-6 rounded-xl border border-border shadow-sm flex flex-col h-[400px]">
              <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-secondary" />
                {chart.title || `Chart ${idx + 1}`}
              </h3>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  {chart.type === 'line' ? (
                    <LineChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey={chart.x} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="top" height={36}/>
                      {chart.y.map((y, i) => (
                        <Line key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      ))}
                    </LineChart>
                  ) : chart.type === 'bar' ? (
                    <BarChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey={chart.x} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="top" height={36}/>
                      {chart.y.map((y, i) => (
                        <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : chart.type === 'area' ? (
                    <AreaChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey={chart.x} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend verticalAlign="top" height={36}/>
                      {chart.y.map((y, i) => (
                        <Area key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.1} strokeWidth={2} />
                      ))}
                    </AreaChart>
                  ) : (
                    <PieChart>
                      <Pie
                        data={rows}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey={chart.y[0]}
                        nameKey={chart.x}
                      >
                        {rows.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Legend />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Raw Table */}
      <section className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border bg-slate-50 flex items-center gap-2">
          <Table className="w-5 h-5 text-slate-500" />
          <h2 className="font-semibold">Raw Data Results</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 uppercase text-xs">
              <tr>
                {Object.keys(rows[0] || {}).map(col => (
                  <th key={col} className="px-6 py-3 font-semibold">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  {Object.values(row).map((val, j) => (
                    <td key={j} className="px-6 py-4 whitespace-nowrap text-slate-700">
                      {String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-center text-slate-400 text-xs py-10 flex items-center justify-center gap-2">
        <Info className="w-3 h-3" />
        Generated by dbcli | Standalone Interactive Report
      </footer>
    </div>
  );
}
