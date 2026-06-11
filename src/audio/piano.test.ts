import { describe, expect, it } from 'vitest';
import { VoiceManager, type NotePlayer } from './piano';

function fakePlayer() {
  const live = new Set<number>();
  const log: string[] = [];
  let id = 0;
  const player: NotePlayer = {
    start(midi) {
      const voice = id++;
      live.add(voice);
      log.push(`start:${midi}#${voice}`);
      return () => {
        if (live.has(voice)) {
          live.delete(voice);
          log.push(`stop:${midi}#${voice}`);
        }
      };
    },
  };
  return { player, live, log };
}

describe('VoiceManager', () => {
  it('re-striking a sounding pitch stops the prior voice first', () => {
    const { player, live, log } = fakePlayer();
    const vm = new VoiceManager(player);
    vm.noteOn(60, 90);
    vm.noteOn(60, 90);
    expect(live.size).toBe(1);
    expect(log).toEqual(['start:60#0', 'stop:60#0', 'start:60#1']);
  });

  it('defers release while the pedal is down and flushes ALL on pedal-up', () => {
    const { player, live } = fakePlayer();
    const vm = new VoiceManager(player);
    vm.pedal(true);
    vm.noteOn(60, 90);
    vm.noteOn(64, 90);
    vm.noteOff(60);
    vm.noteOff(64);
    expect(live.size).toBe(2); // still ringing
    vm.pedal(false);
    expect(live.size).toBe(0);
  });

  it('caps polyphony by stealing the oldest voice', () => {
    const { player, live } = fakePlayer();
    const vm = new VoiceManager(player, 4);
    for (let m = 60; m < 66; m++) vm.noteOn(m, 90);
    expect(live.size).toBe(4);
  });

  it('panic flushes pedal-deferred voices and everything else', () => {
    const { player, live } = fakePlayer();
    const vm = new VoiceManager(player);
    vm.pedal(true);
    vm.noteOn(60, 90);
    vm.noteOff(60); // deferred
    vm.noteOn(64, 90); // still held
    vm.panic();
    expect(live.size).toBe(0);
    expect(vm.activeCount).toBe(0);
  });

  it('re-strike of a pedal-deferred pitch does not double voices', () => {
    const { player, live } = fakePlayer();
    const vm = new VoiceManager(player);
    vm.pedal(true);
    vm.noteOn(60, 90);
    vm.noteOff(60); // deferred, ringing
    vm.noteOn(60, 90); // re-strike stops the ringing instance
    expect(live.size).toBe(1);
  });
});
