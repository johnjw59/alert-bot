'use strict';

require('dotenv').config({ path: __dirname + '/.env' });

const alertEvents = require('../../lib/AlertEvents');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const puppeteer = require('puppeteer');
const schedule = require('node-schedule');
const store = require('store2');
const { exec } = require('child_process');

const CSV_PATH = path.join(__dirname, 'trakt-watched.csv');
const LAST_HASH_KEY = 'letterboxd.last_hash';

/**
 * Export watched movies data from Trakt and import into Letterboxd.
 */
function LetterboxdImporter() {
  // Daily at 7am
  const schedule_rule = '0 0 7 * * *';

  schedule.scheduleJob(schedule_rule, async () => {
    try {
      console.log('Letterboxd Importer started');

      // Generate CSV via trakt-to-letterboxd.
      console.log('Generating CSV via trakt-to-letterboxd...');
      await generateCSV();
      console.log('CSV generated at', CSV_PATH);
      if (!fs.existsSync(CSV_PATH)) {
        throw new Error('CSV generation failed: Output file not found');
      }

      // Only continue if the CSV has changed.
      console.log('Checking if CSV has changed...');
      const new_hash = crypto.createHash('sha256').update(
        fs.readFileSync(CSV_PATH)
      ).digest('hex');
      const old_hash = store.get(LAST_HASH_KEY, null);
      if (new_hash && old_hash && new_hash === old_hash) {
        console.log('CSV unchanged; skipping Letterboxd upload.');
        return;
      }

      // Upload CSV to Letterboxd.
      console.log('Uploading CSV to Letterboxd...');
      await uploadToLetterboxd();
      console.log('Upload to Letterboxd completed.');

      // Update last hash.
      console.log('Updating last hash...');
      store.set(LAST_HASH_KEY, new_hash);

      console.log('Letterboxd Importer completed successfully.');
    }
    catch (err) {
      alertEvents.emitAlert(`⚠ Letterboxd Importer failure: ${err.message}`);
    }
  });
}

// Generate CSV file using trakt-to-letterboxd.
// Path to file is defined in CSV_PATH.
function generateCSV() {
  return new Promise((resolve, reject) => {
    exec(
      `npx trakt-to-letterboxd@1.1.2 -u ${process.env.TRAKT_USERNAME} -f ${CSV_PATH}`,
      { cwd: __dirname },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`trakt-to-letterboxd failed: ${stderr || stdout || error.message}`));
        }
        resolve(stdout);
      }
    );
  });
}

// Upload CSV to Letterboxd using Puppeteer.
async function uploadToLetterboxd() {
  const cookie_path = path.join(__dirname, 'cookies.json');
  let cookies = null;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // Have a race between timeout and upload process.
    await Promise.race([
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Letterboxd upload timeout after 10 minutes')), 10 * 60 * 1000)
      ),
      (async () => {
        // Load cookies.
        if (fs.existsSync(cookie_path)) {
          cookies = JSON.parse(fs.readFileSync(cookie_path, 'utf8'));
          await page.setCookie(...cookies);
        }
        else {
          console.warn('Failed to read cookies.json; continuing');
        }

        // Go to Letterboxd import page.
        await page.goto('https://letterboxd.com/import/', {
          waitUntil: 'networkidle2',
        });

        // Log in (or continue if already logged in).
        const authenticated = (await page.$('a[href="/sign-out/"]')) !== null;

        if (!authenticated) {
          console.log('Logging in to Letterboxd...');

          await page.goto('https://letterboxd.com/sign-in/', {
            waitUntil: 'networkidle2',
          });

          await page.type('input[name="username"]', process.env.LB_USERNAME, { delay: 40 });
          await page.type('input[name="password"]', process.env.LB_PASSWORD, { delay: 40 });

          await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          console.log('Logged in!');
          cookies = await page.cookies();
          fs.writeFileSync(cookie_path, JSON.stringify(cookies, null, 2));
          console.log('Cookies saved.');

          await page.goto('https://letterboxd.com/import/', {
            waitUntil: 'networkidle2',
          });
        }
        else {
          console.log('Already logged in to Letterboxd.');
        }

        // Upload CSV.
        console.log('Uploading CSV...');

        await page.waitForSelector('#upload-imdb-import', { timeout: 10000 });
        const uploadInput = await page.$('#upload-imdb-import');
        await uploadInput.uploadFile(CSV_PATH);

        // Import auto-submits → we wait for navigation
        await page.waitForNavigation({
          timeout: 60 * 1000,
          waitUntil: 'networkidle2',
        });

        console.log('Upload done → checking Save button...');

        // Wait for file to upload and "Save" button to become enabled.
        await page.waitForFunction(
          () => {
            const btn = document.querySelector('a.save-users-imported-imdb-history');
            return btn && !btn.classList.contains('import-button-disabled');
          },
          { timeout: 5 * 60 * 1000 }
        );

        console.log('Save button enabled — clicking...');
        await page.click('a.save-users-imported-imdb-history');

        // Wait for processing to complete.
        console.log('Waiting for import progress...');

        await page.waitForFunction(
          () => {
            const el = document.querySelector('.js-import-progress');
            if (!el) return false;
            return /Saved\s+[\d,]+\s+films\./i.test(el.innerText);
          },
          { timeout: 5 * 60 * 1000 }
        );

        const saved_text = await page.$eval(
          '.js-import-progress',
          (el) => el.innerText.trim()
        );

        console.log('Import complete:', saved_text);

        // Parse number of saved films.
        const match = saved_text.match(/Saved\s+([\d,]+)\s+films/i);
        const saved_count = match ? Number(match[1].replace(/,/g, "")) : null;

        console.log('Saved film count:', saved_count);
      })(),
    ]);
  }
  catch (err) {
    throw err;
  }
}

module.exports = LetterboxdImporter();
