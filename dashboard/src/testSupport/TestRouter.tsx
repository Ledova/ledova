import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router-dom';

const Content = createContext<ReactNode>(null);

function TestContent() {
  return useContext(Content);
}

export function TestRouter({ children, initialEntries }: { children: ReactNode; initialEntries?: InitialEntry[] }) {
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: <TestContent /> }], { initialEntries }));
  useEffect(() => () => router.dispose(), [router]);
  return (
    <Content.Provider value={children}>
      <RouterProvider router={router} />
    </Content.Provider>
  );
}
