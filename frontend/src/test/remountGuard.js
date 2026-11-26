import { act } from '@testing-library/react';
import { expect, vi } from 'vitest';

function expectStableControl(control, getControl, expectedValue) {
  expect(control.isConnected).toBe(true);
  expect(document.activeElement).toBe(control);
  expect(control.value).toBe(expectedValue);
  expect(getControl()).toBe(control);
}

export async function expectStableTyping(user, getControl, text) {
  const control = getControl();
  let expectedValue = control.value;

  for (const character of text) {
    await user.type(control, character);
    expectedValue += character;
    expectStableControl(control, getControl, expectedValue);
  }
  return control;
}

export async function expectStableAcrossRefresh(user, getControl, text, advanceMs) {
  const control = getControl();
  let expectedValue = control.value;

  for (const character of text) {
    await user.type(control, character);
    expectedValue += character;
    expectStableControl(control, getControl, expectedValue);

    if (typeof advanceMs === 'function') {
      await act(advanceMs);
    } else {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(advanceMs);
      });
    }
    expectStableControl(control, getControl, expectedValue);
  }
  return control;
}
