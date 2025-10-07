declare module "asciinema-player" {
  export interface PlayerOptions {
    loop?: boolean
    autoPlay?: boolean
    speed?: number
    theme?: string
    cols?: number
    rows?: number
    fit?: "width" | "height" | "both" | false
    fontSize?: string
    terminalFontFamily?: string
    terminalLineHeight?: number
    poster?: string
    idleTimeLimit?: number
    preload?: boolean
    startAt?: number | string
  }

  export function create(
    src: string,
    container: HTMLElement,
    options?: PlayerOptions
  ): void
}
