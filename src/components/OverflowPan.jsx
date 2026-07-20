import { memo, useEffect, useRef, useState } from 'react'

const OverflowPan = memo(function OverflowPan({
  content,
  className = '',
  innerClassName = '',
  title,
  contentKey,
}) {
  const containerRef = useRef(null)
  const contentRef = useRef(null)
  const frameRef = useRef(0)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [overflowAmount, setOverflowAmount] = useState(0)

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current
      const node = contentRef.current
      if (!container || !node) return

      const containerWidth = container.getBoundingClientRect().width
      const contentWidth = node.scrollWidth
      const nextOverflow = Math.max(0, contentWidth - containerWidth)

      setIsOverflowing(nextOverflow > 2)
      setOverflowAmount(nextOverflow)
    }

    const scheduleMeasure = () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(measure)
    }

    scheduleMeasure()

    const resizeObserver = new ResizeObserver(scheduleMeasure)
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    if (contentRef.current) resizeObserver.observe(contentRef.current)

    window.addEventListener('resize', scheduleMeasure)

    return () => {
      cancelAnimationFrame(frameRef.current)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [contentKey])

  const duration = Math.max(6, overflowAmount / 20)

  return (
    <span
      ref={containerRef}
      className={`overflow-pan ${isOverflowing ? 'overflow-pan--active' : ''} ${className}`}
      style={
        isOverflowing
          ? {
              '--overflow-distance': `${overflowAmount}px`,
              '--overflow-duration': `${duration}s`,
            }
          : undefined
      }
      title={title}
    >
      <span
        ref={contentRef}
        className={`overflow-pan__inner ${innerClassName}`}
      >
        {content}
      </span>
    </span>
  )
}, (prev, next) => {
  return (
    prev.contentKey === next.contentKey &&
    prev.title === next.title &&
    prev.className === next.className &&
    prev.innerClassName === next.innerClassName &&
    prev.content === next.content
  )
})

export default OverflowPan