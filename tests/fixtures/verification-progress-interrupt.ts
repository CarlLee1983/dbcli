// Exercise the registered handler without Windows' untrappable process kill.
process.on('message', (message) => {
  if (message === 'SIGINT') {
    process.emit('SIGINT')
    process.disconnect?.()
  }
})
