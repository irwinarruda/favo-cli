import { Clock } from '@/modules/system/gateways/clock';

export class FixedClock extends Clock {
  constructor(public instant = new Date('2026-10-31T12:00:00.000Z')) {
    super();
  }

  now() {
    return this.instant;
  }

  async sleep() {}
}
