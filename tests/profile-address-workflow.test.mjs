/** Source-contract checks for the sales address split and profile spouse status. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = JSON.parse(read('lib/questionnaire/schema.json'));
const publicSchema = JSON.parse(read('public/questionnaire-schema.json'));
const byKey = key => source.scalar.find(field => field.key === key);

test('address facts remain shared while support owns court destination entry', () => {
  assert.deepEqual(publicSchema, source, 'public schema must be generated from the source questionnaire');

  for (const key of ['regAddress', 'factAddressSame']) {
    const field = byKey(key);
    assert.equal(field.required, true, key);
    assert.deepEqual(field.conditions, [], key + ' is asked by sales');
  }
  const factual = byKey('factAddress');
  assert.equal(factual.required, true);
  assert.deepEqual(factual.conditions, ['factAddressField']);

  const postal = byKey('postAddress');
  assert.equal(postal.required, false);
  assert.deepEqual(postal.conditions, ['profileOnly']);

  const filing = byKey('filingDestination');
  assert.equal(filing.label, 'Куда направляем иск: суд и адрес');
  assert.equal(filing.required, false, 'owner decision 1 Oct: support owns the ISK destination');
  assert.deepEqual(filing.conditions, ['profileOnly']);

  for (const key of ['recommendedDistrict', 'recommendedCourt', 'clientRequestedDistrict', 'clientRequestedCourt', 'registrationChangePosition']) {
    const field = byKey(key);
    assert.equal(field.required, false, key);
    assert.deepEqual(field.conditions, [], key + ' stays in saved profile feeds');
    assert.equal(field.supportOnly, true, key + ' is retired from assessment entry');
  }
  assert.deepEqual(byKey('registrationChangePosition').options, ['', 'agrees', 'refuses', 'undecided']);

  const document = new JSDOM(read('public/questionnaire.html')).window.document;
  const profile = document.getElementById('profileOnly');
  assert.ok(profile);
  assert.equal(profile.querySelector('#regAddress'), null, 'registration fact must not be hidden in the documentologist-only card');
  assert.equal(profile.querySelector('#factAddressSame'), null, 'residence fact must not be hidden in the documentologist-only card');
  assert.ok(profile.querySelector('#postAddress'), 'postal address remains with the documentologist');
  assert.ok(profile.querySelector('#filingDestination')?.closest('[hidden][data-support-only]'), 'historical destination is retained but hidden');
  assert.equal(filing.supportOnly, true);
  for (const key of ['recommendedDistrict', 'recommendedCourt', 'clientRequestedDistrict', 'clientRequestedCourt', 'registrationChangePosition']) {
    assert.ok(document.getElementById(key)?.closest('[hidden][data-support-only]'), key + ' is hidden in both modes');
  }
  assert.ok(document.querySelector('#regAddress')?.closest('section:not(#profileOnly)'));
  assert.ok(document.querySelector('#factAddressSame')?.closest('section:not(#profileOnly)'));
});

test('married-only spouse status mirrors client choices and keeps explicit unknown', () => {
  const client = source.scalar.filter(field => field.key.startsWith('choice:socialStatus:')).map(field => field.key.slice('choice:socialStatus:'.length));
  const partner = source.scalar.filter(field => field.key.startsWith('choice:partnerSocialStatus:')).map(field => field.key.slice('choice:partnerSocialStatus:'.length));
  assert.deepEqual(partner.slice(0, client.length), client);
  assert.equal(partner.at(-1), 'unknown');
  for (const field of source.scalar.filter(field => field.key.startsWith('choice:partnerSocialStatus:'))) {
    assert.ok(!field.conditions.includes('profileOnly'), field.key);
    assert.ok(field.conditions.includes('partnerSocialStatusField'), field.key);
  }
  const other = byKey('partnerSocialOther');
  assert.ok(!other.conditions.includes('profileOnly'));
  assert.ok(other.conditions.includes('partnerSocialOtherField'));

  const document = new JSDOM(read('public/questionnaire.html')).window.document;
  const partnerGroup = document.querySelectorAll('#partnerSocialStatusChips input[name="partnerSocialStatus"]');
  assert.equal(partnerGroup.length, client.length + 1);
  assert.ok([...partnerGroup].some(input => input.value === 'unknown'));
});

test('owner decision 1 Oct: the historical ISK destination is hidden from assessment entry', () => {
  const field = byKey('filingDestination');
  assert.equal(field.required, false, 'the support task asks for it; old answers only prefill that task');
  assert.deepEqual(field.conditions, ['profileOnly'], 'saved profile feed conditions stay intact');
  assert.equal(field.supportOnly, true);
});
