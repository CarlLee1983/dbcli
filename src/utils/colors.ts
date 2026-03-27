import pc from 'picocolors'

export const colors = {
  success: (text: string) => pc.green(text),
  error: (text: string) => pc.red(text),
  warn: (text: string) => pc.yellow(text),
  info: (text: string) => pc.blue(text),
  dim: (text: string) => pc.dim(text),
  bold: (text: string) => pc.bold(text),
  keyword: (text: string) => pc.blue(pc.bold(text)),
}
