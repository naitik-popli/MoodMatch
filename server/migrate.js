import { exec } from 'child_process';

function runMigrations() {
  return new Promise((resolve, reject) => {
    exec('npx drizzle-kit push', (error, stdout, stderr) => {
      if (error) {
        console.error(`Migration error: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.error(`Migration stderr: ${stderr}`);
      }
      console.log(`Migration stdout: ${stdout}`);
      resolve(stdout);
    });
  });
}

runMigrations()
  .then(() => {
    console.log('Migrations completed successfully.');
  })
  .catch((err) => {
    console.error('Migration failed:', err);
  });
