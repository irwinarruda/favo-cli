import { Spinner } from '@/shared/components/Spinner';
import { useApp } from '@/shared/stores/app';

export function Loading() {
  const colors = useApp((state) => state.colors);
  return (
    <box width="100%" height="100%" alignItems="center" justifyContent="center" backgroundColor={colors.background}>
      <Spinner label="loading providers" />
    </box>
  );
}
