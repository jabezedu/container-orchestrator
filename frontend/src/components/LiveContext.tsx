'use client';

import React, { createContext, useContext, useState } from 'react';

interface LiveContextType {
  isLive: boolean;
  setIsLive: (live: boolean) => void;
  toggleLive: () => void;
}

const LiveContext = createContext<LiveContextType>({
  isLive: true,
  setIsLive: () => {},
  toggleLive: () => {},
});

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [isLive, setIsLive] = useState(true);

  return (
    <LiveContext.Provider value={{ isLive, setIsLive, toggleLive: () => setIsLive(prev => !prev) }}>
      {children}
    </LiveContext.Provider>
  );
}

export function useLive() {
  return useContext(LiveContext);
}
