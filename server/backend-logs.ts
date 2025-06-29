import fs from 'fs';
import path from 'path';

export function logToFile(message: string): void {
  const logFilePath = path.resolve(process.cwd(), 'backend.log');
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) {
      console.error('Failed to write log:', err);
    }
  });
}
