// 自動分配演算法：盡量令每位老師的「值勤總時數」相等
// duration in minutes, computed from HH:MM strings
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function durationMinutes(startTime, endTime) {
  const d = toMinutes(endTime) - toMinutes(startTime);
  return d > 0 ? d : 0;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * @param {Array<{id:number,name:string}>} teachers - active teachers only
 * @param {Array<{id:number, start_time:string, end_time:string,
 *   duties: Array<{id:number, needed_count:number}>,
 *   unavailable: Set<number>}>} timeSlots
 * @returns {Array<{duty_id:number, slot_index:number, teacher_id:number|null}>}
 */
function generateAssignments(teachers, timeSlots) {
  const load = new Map(teachers.map((t) => [t.id, 0]));

  // Build flat list of duty "seats" to fill
  let seats = [];
  for (const slot of timeSlots) {
    const duration = durationMinutes(slot.start_time, slot.end_time);
    for (const duty of slot.duties) {
      for (let i = 0; i < duty.needed_count; i++) {
        seats.push({
          duty_id: duty.id,
          slot_index: i,
          slot_id: slot.id,
          duration,
          unavailable: slot.unavailable,
        });
      }
    }
  }

  // Randomise order so ties are broken differently each time "重新分配" is pressed
  shuffle(seats);

  const busyInSlot = new Map(); // slot_id -> Set<teacher_id>
  const results = [];

  for (const seat of seats) {
    if (!busyInSlot.has(seat.slot_id)) busyInSlot.set(seat.slot_id, new Set());
    const busy = busyInSlot.get(seat.slot_id);

    let pool = teachers.filter((t) => !busy.has(t.id) && !seat.unavailable.has(t.id));
    if (pool.length === 0) pool = teachers.filter((t) => !busy.has(t.id));
    if (pool.length === 0) pool = teachers;

    if (pool.length === 0) {
      results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: null });
      continue;
    }

    const minLoad = Math.min(...pool.map((t) => load.get(t.id)));
    const candidates = pool.filter((t) => load.get(t.id) === minLoad);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    load.set(chosen.id, load.get(chosen.id) + seat.duration);
    busy.add(chosen.id);

    results.push({ duty_id: seat.duty_id, slot_index: seat.slot_index, teacher_id: chosen.id });
  }

  return results;
}

module.exports = { generateAssignments, durationMinutes, toMinutes };
