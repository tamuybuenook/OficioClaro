import { describe, it, expect } from 'vitest'
import {
  addDays, startOfWeek, weekDays, todayISO, isValidDate, isValidTime, endTime, formatTimeRange,
  formatDuration, validateJobInput, normalizeJobInput, isReschedule, groupByDate, compareJobs,
  buildQuoteJobDescription, relativeDayLabel, formatDayLong, countByDate,
  type AgendaJob, type JobInput,
} from './agenda'

const base: JobInput = {
  customer_id: null, quote_id: null, description: 'Cambio de canilla', job_date: '2026-10-14',
  start_time: '09:00', duration_minutes: 60, address: null, notes: null, status: 'scheduled',
}

function job(over: Partial<AgendaJob>): AgendaJob {
  return {
    id: 'x', customer_id: null, quote_id: null, description: 'd', job_date: '2026-10-14', start_time: null,
    duration_minutes: null, address: null, notes: null, status: 'scheduled', rescheduled_count: 0,
    cancel_reason: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...over,
  }
}

describe('fechas', () => {
  it('valida fechas reales y rechaza inexistentes', () => {
    expect(isValidDate('2026-10-13')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('13/10/2026')).toBe(false)
    expect(isValidDate(null)).toBe(false)
  })
  it('valida horarios', () => {
    expect(isValidTime('09:30')).toBe(true)
    expect(isValidTime('23:59:00')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('9:30')).toBe(false)
  })
  it('todayISO usa la fecha local, sin pasar por UTC', () => {
    // 23:30 local del 13/10: en UTC-3 ya sería el 14 en UTC, pero la fecha local sigue siendo 13.
    expect(todayISO(new Date(2026, 9, 13, 23, 30))).toBe('2026-10-13')
    expect(todayISO(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })
  it('addDays cruza meses, años y años bisiestos', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('la semana empieza el lunes (también cuando la fecha es domingo)', () => {
    expect(startOfWeek('2026-10-13')).toBe('2026-10-12') // martes
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12') // lunes
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12') // domingo
    expect(weekDays('2026-10-13')).toHaveLength(7)
    expect(weekDays('2026-10-13')[6]).toBe('2026-10-18')
  })
  it('etiquetas relativas y largas', () => {
    expect(relativeDayLabel('2026-10-13', '2026-10-13')).toBe('Hoy')
    expect(relativeDayLabel('2026-10-14', '2026-10-13')).toBe('Mañana')
    expect(relativeDayLabel('2026-10-12', '2026-10-13')).toBe('Ayer')
    expect(relativeDayLabel('2026-10-16', '2026-10-13')).toBe('Viernes 16 de octubre')
    expect(formatDayLong('2027-01-04', '2026-10-13')).toBe('lunes 4 de enero de 2027')
  })
})

describe('horarios', () => {
  it('calcula la hora de fin y no cruza la medianoche', () => {
    expect(endTime('09:00', 90)).toBe('10:30')
    expect(endTime('09:00:00', 60)).toBe('10:00')
    expect(endTime('23:00', 120)).toBeNull()
    expect(endTime(null, 60)).toBeNull()
    expect(endTime('09:00', null)).toBeNull()
  })
  it('formatea rangos y duraciones', () => {
    expect(formatTimeRange('09:00', 90)).toBe('09:00 a 10:30')
    expect(formatTimeRange('09:00', null)).toBe('09:00')
    expect(formatTimeRange(null, 60)).toBe('Sin horario')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(150)).toBe('2 h 30 min')
    expect(formatDuration(null)).toBe('')
  })
})

describe('validateJobInput', () => {
  it('acepta un trabajo completo', () => {
    expect(validateJobInput(base)).toBeNull()
  })
  it('exige descripción', () => {
    expect(validateJobInput({ ...base, description: '   ' })).toMatch(/descripción/)
  })
  it('Programado y En curso exigen fecha; Pendiente no', () => {
    expect(validateJobInput({ ...base, job_date: null, start_time: null })).toMatch(/elegí una fecha/)
    expect(validateJobInput({ ...base, job_date: null, start_time: null, status: 'in_progress' })).toMatch(/elegí una fecha/)
    expect(validateJobInput({ ...base, job_date: null, start_time: null, status: 'pending' })).toBeNull()
  })
  it('no admite horario sin fecha', () => {
    expect(validateJobInput({ ...base, job_date: null, status: 'pending' })).toMatch(/fecha/)
  })
  it('rechaza fecha, hora, duración y estado inválidos', () => {
    expect(validateJobInput({ ...base, job_date: '2026-02-31' })).toMatch(/fecha no es válida/)
    expect(validateJobInput({ ...base, start_time: '25:00' })).toMatch(/horario/)
    expect(validateJobInput({ ...base, duration_minutes: 0 })).toMatch(/duración/)
    expect(validateJobInput({ ...base, duration_minutes: 2000 })).toMatch(/duración/)
    expect(validateJobInput({ ...base, status: 'otro' as any })).toMatch(/estado/)
  })
  it('limita el largo de los textos', () => {
    expect(validateJobInput({ ...base, description: 'a'.repeat(201) })).toMatch(/200/)
    expect(validateJobInput({ ...base, notes: 'a'.repeat(2001) })).toMatch(/2000/)
  })
})

describe('normalizeJobInput', () => {
  it('convierte vacíos en null y recorta la hora', () => {
    const n = normalizeJobInput({ ...base, description: '  Pintura ', address: '  ', notes: '', start_time: '09:00:00', job_date: '' as any })
    expect(n.description).toBe('Pintura')
    expect(n.address).toBeNull()
    expect(n.notes).toBeNull()
    expect(n.start_time).toBe('09:00')
    expect(n.job_date).toBeNull()
  })
})

describe('isReschedule', () => {
  it('cambiar fecha u hora de un trabajo ya fechado es reprogramar', () => {
    expect(isReschedule({ job_date: '2026-10-14', start_time: '09:00:00' }, { job_date: '2026-10-15', start_time: '09:00' })).toBe(true)
    expect(isReschedule({ job_date: '2026-10-14', start_time: '09:00:00' }, { job_date: '2026-10-14', start_time: '10:00' })).toBe(true)
  })
  it('mismo horario en distinto formato no cuenta', () => {
    expect(isReschedule({ job_date: '2026-10-14', start_time: '09:00:00' }, { job_date: '2026-10-14', start_time: '09:00' })).toBe(false)
  })
  it('ponerle fecha por primera vez no es reprogramar', () => {
    expect(isReschedule({ job_date: null, start_time: null }, { job_date: '2026-10-14', start_time: null })).toBe(false)
  })
})

describe('agrupado y orden', () => {
  it('ordena por fecha y hora; los sin hora van al final del día', () => {
    const jobs = [
      job({ id: 'c', job_date: '2026-10-14', start_time: null }),
      job({ id: 'b', job_date: '2026-10-14', start_time: '15:00:00' }),
      job({ id: 'a', job_date: '2026-10-14', start_time: '08:30:00' }),
      job({ id: 'd', job_date: '2026-10-13', start_time: '18:00:00' }),
    ]
    const groups = groupByDate(jobs)
    expect(groups.map((g) => g.date)).toEqual(['2026-10-13', '2026-10-14'])
    expect(groups[1].jobs.map((j) => j.id)).toEqual(['a', 'b', 'c'])
  })
  it('los trabajos sin fecha no entran en grupos por día', () => {
    expect(groupByDate([job({ job_date: null, status: 'pending' })])).toEqual([])
  })
  it('compareJobs es estable por creación ante empate', () => {
    const a = job({ id: 'a', created_at: '2026-10-01T10:00:00Z' })
    const b = job({ id: 'b', created_at: '2026-10-02T10:00:00Z' })
    expect(compareJobs(a, b)).toBeLessThan(0)
  })
  it('countByDate ignora cancelados y terminados', () => {
    const jobs = [job({}), job({ status: 'cancelled' }), job({ status: 'done' }), job({ job_date: '2026-10-15', status: 'pending' })]
    expect(countByDate(jobs)).toEqual({ '2026-10-14': 1, '2026-10-15': 1 })
  })
})

describe('buildQuoteJobDescription', () => {
  it('une los ítems con su cantidad', () => {
    expect(buildQuoteJobDescription([{ description: 'Cambio de canilla', quantity: 2 }, { description: 'Destape', quantity: 1 }], 12))
      .toBe('Cambio de canilla (x2), Destape')
  })
  it('sin ítems, usa el número de presupuesto', () => {
    expect(buildQuoteJobDescription([], 7)).toBe('Presupuesto Nº 00007')
  })
  it('recorta a 200 caracteres', () => {
    const d = buildQuoteJobDescription(Array.from({ length: 30 }, (_, i) => ({ description: `Trabajo número ${i}`, quantity: 1 })), 1)
    expect(d.length).toBeLessThanOrEqual(200)
    expect(d.endsWith('…')).toBe(true)
  })
})
