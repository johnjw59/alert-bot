'use strict';

const alertEvents = require('../../lib/AlertEvents');
const axios = require('axios');
const cheerio = require('cheerio');
const moment = require('moment');
const schedule = require('node-schedule');
const store = require('store2');

function GasWizard() {
  // Daily at 12:00pm.
  const schedule_rule = '0 30 12 * * *';

  const job = schedule.scheduleJob(schedule_rule, () => {
    axios.get('https://gaswizard.ca/gas-prices/vancouver/')
      .then(({ data }) => {
        const $ = cheerio.load(data);

        const $row = $('ul.single-city-prices li').first();
        const $price_elem = $row.find('.fueltype .fuelprice').first();
        const $change_elem = $price_elem.find('.price-direction');

        if (!$change_elem.hasClass('pd-nc')) {
          const date = parseInt(moment(
            $row.find('.datetext').text().trim(),
            'MMM D, YYYY'
          ).format('X'));

          let price = $price_elem.contents()[0].nodeValue.trim();
          price = price.substring(0, price.length - 1);

          let change = $change_elem.text();
          change = change.substring(1, change.length - 1);

          const data = {
            price: price,
            date: date,
          };

          // Keep track of our data.
          const old_data = store.get('gaswizard.latest', { date: -1 });
          store.set('gaswizard.latest', data);

          // Send the alert!
          // But make sure we're looking at a new date. If we've seen this
          // date before, only continue if the price has changed.
          if ((data.date > old_data.date) || ((data.date == old_data.date) && (data.price != old_data.price))) {
            alertEvents.emitAlert(
              `Gas prediction for ${moment(data.date, 'X').format('LL')}: (${($change_elem.hasClass('pd-down')) ? '↓' : '↑'} ${change}) $${data.price}/L`
            );
          }
        }
      });
  });
}

module.exports = GasWizard();
