import type { DutyApi } from './index'

declare global {
  interface Window {
    duty: DutyApi
  }
}

export {}
