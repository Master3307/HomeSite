import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'


const OVERFLOW_TOLERANCE_PX = 2
const MIN_DURATION_SECONDS = 2.5
const PIXELS_PER_SECOND = 50


const OverflowPan = memo(function OverflowPan({
  content,
  className = '',
  innerClassName = '',
  title = '',
  contentKey = '',
}) {
  const containerRef = useRef(null)
  const contentRef = useRef(null)

  const lastMeasurementRef = useRef({
    containerWidth: -1,
    contentWidth: -1,
    overflowAmount: -1,
  })

  const [overflowAmount, setOverflowAmount] = useState(0)


  const measure = useCallback(() => {
    const container = containerRef.current
    const node = contentRef.current

    if (!container || !node) return

    const containerWidth = Math.round(container.getBoundingClientRect().width)
    const contentWidth = Math.ceil(node.scrollWidth)

    const nextOverflowAmount = Math.max(0, contentWidth - containerWidth)

    const previousMeasurement = lastMeasurementRef.current

    if (
      previousMeasurement.containerWidth === containerWidth &&
      previousMeasurement.contentWidth === contentWidth &&
      previousMeasurement.overflowAmount === nextOverflowAmount
    ) {
      return
    }

    lastMeasurementRef.current = {
      containerWidth,
      contentWidth,
      overflowAmount: nextOverflowAmount,
    }

    setOverflowAmount(previousOverflowAmount => {
      return previousOverflowAmount === nextOverflowAmount
        ? previousOverflowAmount
        : nextOverflowAmount
    })
  }, [])


  // Measures immediately after React writes to the DOM, before the browser
  // paints. This prevents the initial "not moving → moving" visual flash.
  useLayoutEffect(() => {
    lastMeasurementRef.current = {
      containerWidth: -1,
      contentWidth: -1,
      overflowAmount: -1,
    }

    measure()
  }, [contentKey, measure])


  // React only needs to measure again when the available card width or the
  // rendered content's dimensions genuinely change.
  useLayoutEffect(() => {
    const container = containerRef.current
    const node = contentRef.current

    if (!container || !node) return undefined

    const resizeObserver = new ResizeObserver(() => {
      measure()
    })

    resizeObserver.observe(container)
    resizeObserver.observe(node)

    return () => {
      resizeObserver.disconnect()
    }
  }, [measure])


  const isOverflowing = overflowAmount > OVERFLOW_TOLERANCE_PX

  const duration = Math.max(
    MIN_DURATION_SECONDS,
    overflowAmount / PIXELS_PER_SECOND,
  )


  return (
    <span
      ref={containerRef}
      className={[
        'overflow-pan',
        isOverflowing ? 'overflow-pan--active' : '',
        className,
      ].filter(Boolean).join(' ')}
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
        className={[
          'overflow-pan__inner',
          innerClassName,
        ].filter(Boolean).join(' ')}
      >
        {content}
      </span>
    </span>
  )
}, (previousProps, nextProps) => {
  return (
    previousProps.contentKey === nextProps.contentKey &&
    previousProps.className === nextProps.className &&
    previousProps.innerClassName === nextProps.innerClassName &&
    previousProps.title === nextProps.title
  )
})


export default OverflowPan
