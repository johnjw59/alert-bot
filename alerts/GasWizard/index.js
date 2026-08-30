'use strict';

const alertEvents = require('../../lib/AlertEvents');
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');
const schedule = require('node-schedule');
const store = require('store2');

function GasWizard() {
  // Daily at noon-ish or something.
  const schedule_rule = '0 30 12 * * *';

  const job = schedule.scheduleJob(schedule_rule, () => {
    console.log('[GasWizard] check triggered');

    axios.get('https://gaswizard.ca/gas-prices/vancouver/')
      .then(({ page }) => {
        const $ = cheerio.load(page);

        const $row = $('ul.single-city-prices li').first();
        const $price_elem = $row.find('.fueltype .fuelprice').first();
        const $change_elem = $price_elem.find('.price-direction');

        // Scrape the date from the page.
        const date = parseInt(moment(
          $row.find('.datetext').text().trim(),
          'MMM D, YYYY'
        ).format('X'));

        const price = $price_elem.find('.fuel-price-value').text();

        const data = {
          price: price,
          date: date,
        };

        const old_data = store.get('gaswizard.latest', { date: -1 });

        console.log('[GasWizard] new data', data, 'old data', old_data);

        // Update our stored data.
        store.set('gaswizard.latest', data);

        // Only send an alert if the price has changed.
        if ((old_data.date == -1) || (data.price != old_data.price)) {
          let change;

          // Determine the change in price.
          // If we have no old data, use the change element from the page.
          if (old_data.date == -1) {
            change = parseInt($change_elem.find('.price-text').text().replace('¢', ''), 10);
          }
          else {
            change = Math.round(parseFloat(data.price) - parseFloat(old_data.price));
          }

          alertEvents.emitAlert(
            `Gas prediction for ${moment(data.date, 'X').format('LL')}: (${change < 0 ? '↓' : '↑'} ${Math.abs(change)}¢) $${data.price}/L`
          );
          console.log('[GasWizard] alert sent');
        }
        else {
          console.log('[GasWizard] no price change found.');
        }
      })
      .catch((error) => {
        console.error('[GasWizard] check failed:', error);
      });
  });
}

module.exports = GasWizard();
