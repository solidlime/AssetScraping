"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface DateFilterContextType {
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
}

const DateFilterContext = createContext<DateFilterContextType | null>(null);

export function useDateFilter() {
  return useContext(DateFilterContext);
}

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  return (
    <DateFilterContext.Provider value={{ selectedDate, onDateChange: setSelectedDate }}>
      {children}
    </DateFilterContext.Provider>
  );
}
