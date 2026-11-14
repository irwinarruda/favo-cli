export function createStandardOutput(stream: NodeJS.WriteStream) {
  let isReaderGone = false;
  stream.on('error', () => {
    isReaderGone = true;
  });
  return {
    print(line: string) {
      if (!isReaderGone) stream.write(`${line}\n`);
    },
    flushed() {
      if (isReaderGone) return Promise.resolve();
      return new Promise<void>((resolve) => {
        stream.once('error', () => resolve());
        stream.end(() => resolve());
      });
    },
  };
}
