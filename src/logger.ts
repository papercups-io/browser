class Logger {
  debugModeEnabled: boolean;

  constructor(debugModeEnabled?: boolean) {
    this.debugModeEnabled = !!debugModeEnabled;
  }

  debug(...args: any) {
    if (!this.debugModeEnabled) {
      return;
    }

    console.debug('[@papercups/browser]', ...args);
  }

  log(...args: any) {
    if (!this.debugModeEnabled) {
      return;
    }

    console.log('[@papercups/browser]', ...args);
  }

  info(...args: any) {
    console.info('[@papercups/browser]', ...args);
  }

  warn(...args: any) {
    console.warn('[@papercups/browser]', ...args);
  }

  error(...args: any) {
    console.error('[@papercups/browser]', ...args);
  }
}

export default Logger;
