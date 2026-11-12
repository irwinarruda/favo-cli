import { testRender } from '@opentui/react/test-utils';
import { getApp } from '@/__tests__/utils/getApp';
import { App } from '@/App';

const writeError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes('not wrapped in act')) writeError(...args);
};

const EscapeSettleMs = 30;

export const WideScreen = { width: 130, height: 36 };

export async function renderApp(screen = WideScreen) {
  const app = await getApp({ isLoaded: false });
  let quitCount = 0;
  const setup = await testRender(<App onQuit={() => quitCount++} />, { ...screen, useMouse: true });
  await setup.waitFor(() => app.state.fleetSummary.signedIn > 0);
  await setup.flush();
  return {
    ...setup,
    app,
    get quitCount() {
      return quitCount;
    },
    async press(...keys: string[]) {
      for (const key of keys) {
        setup.mockInput.pressKey(key);
        await setup.flush();
      }
      await setup.renderOnce();
    },
    async pressArrow(...directions: ('up' | 'down' | 'left' | 'right')[]) {
      for (const direction of directions) {
        setup.mockInput.pressArrow(direction);
        await setup.flush();
      }
      await setup.renderOnce();
    },
    async pressEscape() {
      setup.mockInput.pressEscape();
      await Bun.sleep(EscapeSettleMs);
      await setup.flush();
      await setup.renderOnce();
    },
    async select(key: string) {
      app.state.selectRow(key);
      await setup.flush();
      await setup.renderOnce();
    },
    async clickOn(text: string) {
      const lines = setup.captureCharFrame().split('\n');
      const y = lines.findIndex((line) => line.includes(text));
      if (y < 0) throw new Error(`"${text}" is not on the screen.`);
      await setup.mockMouse.click(lines[y]!.indexOf(text), y);
      await setup.flush();
      await setup.renderOnce();
    },
  };
}
