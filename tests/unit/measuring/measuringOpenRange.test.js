/**
 * @fileoverview Regression test: measuring queries accept an omitted date bound.
 *
 * total(), average() and list() documented both bounds as required, but calling
 * total('visits') threw "Cannot read properties of undefined (reading 'getTime')".
 * A missing bound now means open-ended.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const createMeasuringService = require('../../../src/measuring');
const EventEmitter = require('events');

describe('MeasuringService open-ended date ranges', () => {
  let measuring;

  beforeEach(() => {
    measuring = createMeasuringService('default', {}, new EventEmitter());
    measuring.add('visits', 2);
    measuring.add('visits', 3);
  });

  afterEach(() => {
    measuring?.eventEmitter_?.removeAllListeners?.();
  });

  test('total() without dates sums all measures', () => {
    expect(measuring.total('visits')).toBe(5);
  });

  test('average() without dates averages all measures', () => {
    expect(measuring.average('visits')).toBe(2.5);
  });

  test('list() without dates returns all measures', () => {
    expect(measuring.list('visits')).toHaveLength(2);
  });

  test('a start date alone keeps only later measures', () => {
    const future = new Date(Date.now() + 60_000);
    expect(measuring.total('visits', future)).toBe(0);
  });

  test('an end date alone keeps only earlier measures', () => {
    const past = new Date(Date.now() - 60_000);
    expect(measuring.total('visits', undefined, past)).toBe(0);
  });

  test('an unknown metric still returns zero', () => {
    expect(measuring.total('missing')).toBe(0);
  });
});
