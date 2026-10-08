import { describe, expect, it } from 'vitest';
import { exactCount, eventsPerDevice, eventVolumeExplanation, featureMeasurementNote, featureMeasurementState, unclassifiedEvents } from '../src/lib/feature-measurement';

describe('feature metric units', () => {
  it('distinguishes missing emitters, real empty results and unreadable sources', () => {
    for (const key of ['mail_signin_screen_view', 'inbox_viewed', 'autocategory_applied', 'kyc_reply_sent', 'preferences_updated']) {
      expect(featureMeasurementState(key, true, true, undefined)).toBe('not_tracked');
      expect(featureMeasurementState(key, true, true, 0)).toBe('not_tracked');
      // Preserve historical and newly arriving evidence even if the catalogue lags.
      expect(featureMeasurementState(key, true, false, 2)).toBe('observed');
    }
    expect(featureMeasurementState('receipt_sync', true, true, undefined)).toBe('empty');
    expect(featureMeasurementState('receipt_sync', false, true, undefined)).toBe('unavailable');
    expect(featureMeasurementState('receipt_sync', false, true, 2)).toBe('unavailable');
    expect(featureMeasurementState('client_handoff', true, true, undefined, true)).toBe('not_tracked');
  });

  it('shows the exact value hidden by compact rounding', () => {
    expect(exactCount(6678)).toBe('6,678');
    expect(eventVolumeExplanation(6678, 12)).toContain('6,678 records from 12 device/browser IDs');
    expect(eventVolumeExplanation(6678, 12)).toContain('Repeats count again');
    expect(eventsPerDevice(25, 6)).toBe('4.2');
  });

  it('does not invent an average for unknown or zero devices', () => {
    expect(eventsPerDevice(0, 0)).toBe('—');
    expect(eventsPerDevice(10, null)).toBe('—');
    expect(eventsPerDevice(null, 12)).toBe('—');
    expect(eventsPerDevice(0, 12)).toBe('0.0');
  });

  it('keeps unclassified records separate from successes and expected blocks', () => {
    expect(unclassifiedEvents(100, 60, 10, 5)).toBe(25);
    expect(unclassifiedEvents(10, 0, 0, 0)).toBe(10);
    expect(unclassifiedEvents(null, 0, 0, 0)).toBeNull();
    expect(unclassifiedEvents(10, null, 0, 0)).toBeNull();
    expect(exactCount(null)).toBe('—');
  });

  it('explains viewing, confirmation and queued-job stages without claiming completions', () => {
    expect(featureMeasurementNote('location_viewed')).toContain('location_share_viewed');
    expect(featureMeasurementNote('live_sharing')).toContain('Check-In');
    expect(featureMeasurementNote('receipt_sync')).toContain('accepted, not completed');
    expect(featureMeasurementNote('memory_capture_saved')).toContain('action=capture_saved');
  });
});
