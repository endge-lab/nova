export class NovaGraphics {
  private static assetsMap = new Map<string, HTMLCanvasElement>()

  /**
   * Получение канваса с графическим активом по имени.
   */
  static getAsset(name: string): HTMLCanvasElement | undefined {
    return this.assetsMap.get(name)
  }

  /**
   * Возвращает DPR (device pixel ratio).
   */
  static dpr(): number {
    return window.devicePixelRatio || 1
  }

  /**
   * Утемняет цвет (hex) на указанный коэффициент.
   */
  static darkenColor(hex: string, factor: number): string {
    const cleanHex = hex.replace('#', '')
    const r = parseInt(cleanHex.substring(0, 2), 16)
    const g = parseInt(cleanHex.substring(2, 4), 16)
    const b = parseInt(cleanHex.substring(4, 6), 16)
    const darken = (component: number) =>
      Math.max(0, Math.min(255, Math.floor(component * factor)))
    return `#${darken(r).toString(16).padStart(2, '0')}${darken(g)
      .toString(16)
      .padStart(2, '0')}${darken(b).toString(16).padStart(2, '0')}`
  }

  /**
   * Создает паттерн с диагональными линиями.
   */
  static createStripePattern(
    name: string,
    params: {
      stripeColor: string
      bgColor: string
      stripeWidth: number
      angle?: number
      sizeK?: number
    }
  ): HTMLCanvasElement | null {
    if (this.assetsMap.has(name)) {
      console.warn(`Pattern "${name}" already exists`)
      return this.assetsMap.get(name)!
    }

    const { stripeColor, bgColor, stripeWidth, angle = 45, sizeK = 50 } = params
    const patternSize = Math.ceil(Math.sqrt(2) * stripeWidth * sizeK)
    const patternCanvas = document.createElement('canvas')
    const patternCtx = patternCanvas.getContext('2d')

    if (!patternCtx) return null

    patternCanvas.width = patternSize
    patternCanvas.height = patternSize

    patternCtx.fillStyle = bgColor
    patternCtx.fillRect(0, 0, patternSize, patternSize)

    patternCtx.translate(patternSize / 2, patternSize / 2)
    patternCtx.rotate((angle * Math.PI) / 180)
    patternCtx.translate(-patternSize / 2, -patternSize / 2)

    patternCtx.fillStyle = stripeColor
    for (let i = -patternSize; i < patternSize * 2; i += stripeWidth * 2) {
      patternCtx.fillRect(i, 0, stripeWidth, patternSize * 2)
    }

    this.assetsMap.set(name, patternCanvas)
    return patternCanvas
  }

  static async createIcon(
    name: string,
    svgContent: string,
    fillColor = 'black',
    w = 128,
    h = 128,
  ): Promise<HTMLCanvasElement> {
    if (this.assetsMap.has(name)) {
      console.warn(`Icon "${name}" already exists`)
      return this.assetsMap.get(name)!
    }

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    const svgWithColor = svgContent.replace('currentColor', fillColor)
    const blob = new Blob([svgWithColor], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.src = url
    await img.decode()

    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)

    this.assetsMap.set(name, canvas)
    return canvas
  }
}
