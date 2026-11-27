import React, { useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { focusIslandWindow, playChimeCue } from '../../utils/tauriBridge';
import {
  formatAgendaDateHeading,
  formatLocalDateISO,
  getMonthCalendarCells,
  getRemindersForDate,
  ID_MONTHS_FULL,
  isPastDateISO,
  MAX_REMINDER_ITEMS,
  MAX_REMINDER_TITLE_LEN,
  type ReminderRepeat,
} from './calendarScheduleLogic';
import {
  addReminder,
  removeReminder,
  toggleReminderEnabled,
  useCalendarStore,
} from './calendarStore';

const WEEKDAY_HEADERS = ['Sn', 'Sl', 'Rb', 'Km', 'Jm', 'Sb', 'Mg'];

const REPEAT_OPTIONS: { value: ReminderRepeat; label: string }[] = [
  { value: 'once', label: 'Sekali' },
  { value: 'daily', label: 'Harian' },
  { value: 'weekdays', label: 'Sen–Jum' },
];

export const CalendarExpandedView: React.FC = () => {
  const { settings, palette } = useSettingsStore();
  const { reminders } = useCalendarStore();
  const isMonochrome = settings.theme === 'monochrome';
  const accentColor = isMonochrome ? '#FFFFFF' : '#FB7185';
  const activeTagBg = isMonochrome
    ? 'rgba(255, 255, 255, 0.14)'
    : 'rgba(251, 113, 133, 0.16)';

  const now = new Date();
  const todayISO = formatLocalDateISO(now);

  const [viewYear, setViewYear] = useState<number>(() => now.getFullYear());
  const [viewMonth0, setViewMonth0] = useState<number>(() => now.getMonth());
  const [selectedDateISO, setSelectedDateISO] = useState<string>(() => todayISO);

  const [titleInput, setTitleInput] = useState('');
  const [timeInput, setTimeInput] = useState('09:00');
  const [repeatInput, setRepeatInput] = useState<ReminderRepeat>('once');
  const [formError, setFormError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const isSelectedPast = useMemo(
    () => isPastDateISO(selectedDateISO),
    [selectedDateISO]
  );

  const monthCells = useMemo(
    () => getMonthCalendarCells(viewYear, viewMonth0, reminders, new Date()),
    [viewYear, viewMonth0, reminders]
  );

  const agendaItems = useMemo(
    () => getRemindersForDate(reminders, selectedDateISO),
    [reminders, selectedDateISO]
  );

  const headingMeta = useMemo(
    () => formatAgendaDateHeading(selectedDateISO, new Date()),
    [selectedDateISO]
  );

  const handleShiftMonth = (delta: number) => {
    playChimeCue('tap');
    const shifted = new Date(viewYear, viewMonth0 + delta, 1, 12, 0, 0, 0);
    setViewYear(shifted.getFullYear());
    setViewMonth0(shifted.getMonth());
  };

  const handleJumpToday = () => {
    playChimeCue('tap');
    const cur = new Date();
    const curISO = formatLocalDateISO(cur);
    setViewYear(cur.getFullYear());
    setViewMonth0(cur.getMonth());
    setSelectedDateISO(curISO);
    setFormError(null);
  };

  const handleSelectDate = (dateISO: string, inCurrentMonth: boolean) => {
    playChimeCue('tap');
    setSelectedDateISO(dateISO);
    setFormError(null);
    if (!inCurrentMonth) {
      const [y, m] = dateISO.split('-').map(Number);
      if (Number.isFinite(y) && Number.isFinite(m)) {
        setViewYear(y);
        setViewMonth0(m - 1);
      }
    }
    if (isPastDateISO(dateISO) && repeatInput === 'once') {
      setRepeatInput('daily');
    }
  };

  const handleSubmitQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const effectiveRepeat: ReminderRepeat =
      isSelectedPast && repeatInput === 'once' ? 'daily' : repeatInput;

    const result = addReminder({
      title: titleInput,
      dateISO: selectedDateISO,
      timeHHMM: timeInput,
      repeat: effectiveRepeat,
    });

    if (!result.ok) {
      setFormError(result.error ?? 'Gagal menambahkan agenda.');
      return;
    }

    playChimeCue('tap');
    setTitleInput('');
    setFormError(null);
    titleInputRef.current?.focus();
  };

  const monthLabel = `${ID_MONTHS_FULL[viewMonth0] ?? ''} ${viewYear}`;
  const isSixRowMonth = monthCells.length > 35;
  const showTodayShortcut =
    viewYear !== now.getFullYear() ||
    viewMonth0 !== now.getMonth() ||
    selectedDateISO !== todayISO;

  return (
    <div
      data-tauri-drag-region="false"
      data-calendar-layout="split-2col"
      onClick={(e) => e.stopPropagation()}
      className="w-full h-full bg-[#000000] px-3 py-1.5 flex gap-2.5 select-none overflow-hidden"
    >
      {/* Left Column: Full Monthly Calendar (1-31) */}
      <div className="w-[214px] shrink-0 h-full flex flex-col justify-between pr-2.5 border-r border-white/[0.08]">
        <div className="flex items-center justify-between gap-1 h-[20px] shrink-0">
          <span
            className="text-[10.5px] font-semibold text-white tracking-tight truncate"
            title={monthLabel}
          >
            {monthLabel}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => handleShiftMonth(-1)}
              className="w-[18px] h-[18px] rounded-md bg-white/[0.05] hover:bg-white/[0.14] text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Bulan sebelumnya"
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            {showTodayShortcut && (
              <button
                type="button"
                data-calendar-today-btn="true"
                onClick={handleJumpToday}
                className="px-1.5 h-[18px] rounded-md bg-white/[0.06] hover:bg-white/[0.15] text-[8.5px] font-medium text-white/80 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                title="Kembali ke hari ini"
              >
                Hari Ini
              </button>
            )}
            <button
              type="button"
              onClick={() => handleShiftMonth(1)}
              className="w-[18px] h-[18px] rounded-md bg-white/[0.05] hover:bg-white/[0.14] text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Bulan berikutnya"
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Weekday Row */}
        <div className="grid grid-cols-7 gap-[2px] pt-0.5 shrink-0">
          {WEEKDAY_HEADERS.map((wd) => (
            <span
              key={wd}
              className="text-[8.5px] font-mono text-white/40 text-center leading-none"
            >
              {wd}
            </span>
          ))}
        </div>

        {/* 1-31 Clickable Date Grid */}
        <div
          data-calendar-grid="true"
          className="grid grid-cols-7 gap-[2px] flex-1 min-h-0 content-start pt-0.5"
        >
          {monthCells.map((cell) => {
            const isSelected = cell.dateISO === selectedDateISO;
            const hasOnceDot = cell.onceCount > 0;
            return (
              <button
                key={cell.dateISO}
                type="button"
                data-calendar-date={cell.dateISO}
                data-in-month={cell.inCurrentMonth ? 'true' : 'false'}
                onClick={() => handleSelectDate(cell.dateISO, cell.inCurrentMonth)}
                style={
                  isSelected
                    ? { backgroundColor: accentColor, color: '#000000' }
                    : cell.isToday
                    ? { borderColor: accentColor }
                    : undefined
                }
                className={`relative w-full ${
                  isSixRowMonth ? 'h-[18px]' : 'h-[21px]'
                } rounded-[5px] flex items-center justify-center font-mono text-[9.5px] tabular-nums leading-none transition-colors cursor-pointer ${
                  isSelected
                    ? 'font-bold'
                    : cell.isToday
                    ? 'border text-white font-semibold bg-white/[0.06] hover:bg-white/[0.14]'
                    : cell.inCurrentMonth
                    ? cell.isPast
                      ? 'text-white/45 hover:bg-white/[0.08] hover:text-white/80'
                      : 'text-white/85 hover:bg-white/[0.10]'
                    : 'text-white/20 hover:bg-white/[0.05]'
                }`}
                title={cell.dateISO}
              >
                <span>{cell.day}</span>
                {hasOnceDot && (
                  <span
                    aria-hidden="true"
                    style={{
                      backgroundColor: isSelected ? '#000000' : accentColor,
                    }}
                    className="absolute bottom-[1.5px] w-[3px] h-[3px] rounded-full pointer-events-none"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Column: Selected Date Header + 1-Line Quick Add + Agenda List */}
      <div className="flex-1 min-w-0 h-full flex flex-col gap-1.5 overflow-hidden">
        <div className="flex items-center justify-between gap-2 h-[18px] shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <CalendarDays
              className="w-3 h-3 shrink-0"
              style={{ color: accentColor }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-semibold text-white truncate">
              {headingMeta.label}
            </span>
            {headingMeta.isToday && (
              <span
                style={{
                  backgroundColor: activeTagBg,
                  color: accentColor,
                }}
                className="px-1.5 py-[1px] rounded-full text-[8.5px] font-semibold leading-none shrink-0"
              >
                Hari Ini
              </span>
            )}
            {headingMeta.isPast && (
              <span className="px-1.5 py-[1px] rounded-full bg-white/[0.06] text-[8.5px] text-white/45 leading-none shrink-0">
                Lewat
              </span>
            )}
          </div>
          <span
            className="text-[9px] font-mono tabular-nums text-white/45 shrink-0"
            title={`Maksimal ${MAX_REMINDER_ITEMS} agenda tersimpan`}
          >
            {reminders.length}/{MAX_REMINDER_ITEMS}
          </span>
        </div>

        {/* 1-Line Quick Add Form */}
        <form
          onSubmit={handleSubmitQuickAdd}
          className="flex items-center gap-1 shrink-0"
        >
          <input
            ref={titleInputRef}
            type="text"
            value={titleInput}
            maxLength={MAX_REMINDER_TITLE_LEN}
            placeholder="Tambah pengingat..."
            aria-label="Judul pengingat"
            onMouseDown={() => void focusIslandWindow()}
            onFocus={() => void focusIslandWindow()}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
            onChange={(e) => {
              setTitleInput(e.target.value);
              if (formError) setFormError(null);
            }}
            className="flex-1 min-w-0 h-[24px] px-2 rounded-lg bg-white/[0.05] border border-white/[0.10] text-[10px] text-white placeholder:text-white/35 focus:outline-none focus:border-white/35"
          />
          <input
            type="time"
            value={timeInput}
            aria-label="Jam pengingat"
            onMouseDown={() => void focusIslandWindow()}
            onFocus={() => void focusIslandWindow()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              setTimeInput(e.target.value);
              if (formError) setFormError(null);
            }}
            className="w-[66px] shrink-0 h-[24px] px-1 rounded-lg bg-white/[0.05] border border-white/[0.10] text-[9.5px] font-mono tabular-nums text-white [color-scheme:dark] focus:outline-none focus:border-white/35"
          />
          <select
            value={isSelectedPast && repeatInput === 'once' ? 'daily' : repeatInput}
            aria-label="Frekuensi pengingat"
            onMouseDown={() => void focusIslandWindow()}
            onChange={(e) => setRepeatInput(e.target.value as ReminderRepeat)}
            className="w-[72px] shrink-0 h-[24px] px-1 rounded-lg bg-[#121215] border border-white/[0.10] text-[9.5px] text-white/85 focus:outline-none focus:border-white/35 cursor-pointer"
          >
            {REPEAT_OPTIONS.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={opt.value === 'once' && isSelectedPast}
              >
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={
              titleInput.trim().length === 0 ||
              reminders.length >= MAX_REMINDER_ITEMS
            }
            style={{ backgroundColor: accentColor, color: '#000000' }}
            className="w-[24px] h-[24px] shrink-0 rounded-lg flex items-center justify-center font-bold hover:brightness-95 active:scale-95 transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            title="Simpan pengingat"
            aria-label="Simpan pengingat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </form>

        {formError && (
          <div
            className="text-[9px] leading-none px-0.5 truncate shrink-0"
            style={{ color: palette.danger }}
          >
            {formError}
          </div>
        )}

        {/* Agenda List */}
        <div className="flex-1 min-h-0 overflow-y-auto oled-thin-scrollbar space-y-1 pr-0.5">
          {agendaItems.length === 0 ? (
            <div className="h-full min-h-[70px] flex flex-col items-center justify-center text-center px-3">
              <span className="text-[10px] text-white/35">
                Belum ada agenda di tanggal ini
              </span>
              <span className="text-[8.5px] text-white/25 mt-0.5">
                Ketik judul + jam di atas lalu tekan Enter
              </span>
            </div>
          ) : (
            agendaItems.map((item) => {
              const isSnoozed = item.snoozedUntilMs !== null;
              return (
                <div
                  key={item.id}
                  data-calendar-agenda-item={item.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.035] border border-white/[0.07] hover:border-white/[0.14] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      playChimeCue('tap');
                      toggleReminderEnabled(item.id);
                    }}
                    style={
                      item.enabled
                        ? {
                            backgroundColor: accentColor,
                            borderColor: accentColor,
                            color: '#000000',
                          }
                        : undefined
                    }
                    className={`w-[14px] h-[14px] rounded-[4px] border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                      item.enabled
                        ? ''
                        : 'border-white/25 bg-transparent hover:border-white/50'
                    }`}
                    title={item.enabled ? 'Nonaktifkan pengingat' : 'Aktifkan pengingat'}
                    aria-label={item.enabled ? 'Nonaktifkan pengingat' : 'Aktifkan pengingat'}
                  >
                    {item.enabled && <Check className="w-2.5 h-2.5 stroke-[2.8]" />}
                  </button>

                  <span
                    className={`font-mono text-[9.5px] tabular-nums shrink-0 ${
                      item.enabled ? 'text-white/85' : 'text-white/35'
                    }`}
                  >
                    {item.timeHHMM}
                  </span>

                  <span
                    className={`text-[10px] flex-1 min-w-0 truncate ${
                      item.enabled ? 'text-white/95' : 'text-white/35 line-through'
                    }`}
                    title={item.title}
                  >
                    {item.title}
                  </span>

                  {item.repeat !== 'once' && (
                    <span className="px-1 py-[1px] rounded bg-white/[0.07] text-[8px] font-medium text-white/60 shrink-0">
                      {item.repeat === 'daily' ? 'Harian' : 'Sen–Jum'}
                    </span>
                  )}

                  {isSnoozed && (
                    <span
                      style={{
                        backgroundColor: activeTagBg,
                        color: accentColor,
                      }}
                      className="px-1 py-[1px] rounded text-[8px] font-semibold shrink-0"
                    >
                      Snoozed
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      playChimeCue('tap');
                      removeReminder(item.id);
                    }}
                    className="w-[18px] h-[18px] rounded flex items-center justify-center text-white/35 hover:text-white/85 hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
                    title="Hapus pengingat"
                    aria-label={`Hapus ${item.title}`}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
