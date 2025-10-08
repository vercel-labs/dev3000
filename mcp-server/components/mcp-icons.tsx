import { useId } from "react"

export function NextJsIcon({ className }: { className?: string }) {
  const lightMaskId = useId()
  const lightPaint0Id = useId()
  const lightPaint1Id = useId()
  const darkMaskId = useId()
  const darkPaint0Id = useId()
  const darkPaint1Id = useId()

  return (
    <>
      {/* Light mode */}
      <svg
        aria-label="Next.js logomark"
        className={`${className} block dark:hidden`}
        height="16"
        role="img"
        viewBox="0 0 180 180"
        width="16"
      >
        <mask
          height="180"
          id={lightMaskId}
          maskUnits="userSpaceOnUse"
          width="180"
          x="0"
          y="0"
          style={{ maskType: "alpha" }}
        >
          <circle cx="90" cy="90" fill="black" r="90" />
        </mask>
        <g mask={`url(#${lightMaskId})`}>
          <circle cx="90" cy="90" fill="black" r="90" />
          <path
            d="M149.508 157.52L69.142 54H54V125.97H66.1136V69.3836L139.999 164.845C143.333 162.614 146.509 160.165 149.508 157.52Z"
            fill={`url(#${lightPaint0Id})`}
          />
          <rect fill={`url(#${lightPaint1Id})`} height="72" width="12" x="115" y="54" />
        </g>
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={lightPaint0Id} x1="109" x2="144.5" y1="116.5" y2="160.5">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient gradientUnits="userSpaceOnUse" id={lightPaint1Id} x1="121" x2="120.799" y1="54" y2="106.875">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Dark mode */}
      <svg
        aria-label="Next.js logomark"
        className={`${className} hidden dark:block`}
        height="16"
        role="img"
        viewBox="0 0 180 180"
        width="16"
      >
        <mask
          height="180"
          id={darkMaskId}
          maskUnits="userSpaceOnUse"
          width="180"
          x="0"
          y="0"
          style={{ maskType: "alpha" }}
        >
          <circle cx="90" cy="90" fill="black" r="90" />
        </mask>
        <g mask={`url(#${darkMaskId})`}>
          <circle cx="90" cy="90" fill="white" r="90" />
          <path
            d="M149.508 157.52L69.142 54H54V125.97H66.1136V69.3836L139.999 164.845C143.333 162.614 146.509 160.165 149.508 157.52Z"
            fill={`url(#${darkPaint0Id})`}
          />
          <rect fill={`url(#${darkPaint1Id})`} height="72" width="12" x="115" y="54" />
        </g>
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={darkPaint0Id} x1="109" x2="144.5" y1="116.5" y2="160.5">
            <stop stopColor="black" />
            <stop offset="1" stopColor="black" stopOpacity="0" />
          </linearGradient>
          <linearGradient gradientUnits="userSpaceOnUse" id={darkPaint1Id} x1="121" x2="120.799" y1="54" y2="106.875">
            <stop stopColor="black" />
            <stop offset="1" stopColor="black" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </>
  )
}

export function ChromeIcon({ className }: { className?: string }) {
  const gradientAId = useId()
  const gradientBId = useId()
  const gradientCId = useId()

  return (
    <svg className={className} viewBox="0 0 48 48" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradientAId} x1="3.2173" y1="15" x2="44.7812" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d93025" />
          <stop offset="1" stopColor="#ea4335" />
        </linearGradient>
        <linearGradient
          id={gradientBId}
          x1="20.7219"
          y1="47.6791"
          x2="41.5039"
          y2="11.6837"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fcc934" />
          <stop offset="1" stopColor="#fbbc04" />
        </linearGradient>
        <linearGradient
          id={gradientCId}
          x1="26.5981"
          y1="46.5015"
          x2="5.8161"
          y2="10.506"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#1e8e3e" />
          <stop offset="1" stopColor="#34a853" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="23.9947" r="12" style={{ fill: "#fff" }} />
      <path
        d="M3.2154,36A24,24,0,1,0,12,3.2154,24,24,0,0,0,3.2154,36ZM34.3923,18A12,12,0,1,1,18,13.6077,12,12,0,0,1,34.3923,18Z"
        style={{ fill: "none" }}
      />
      <path
        d="M24,12H44.7812a23.9939,23.9939,0,0,0-41.5639.0029L13.6079,30l.0093-.0024A11.9852,11.9852,0,0,1,24,12Z"
        style={{ fill: `url(#${gradientAId})` }}
      />
      <circle cx="24" cy="24" r="9.5" style={{ fill: "#1a73e8" }} />
      <path
        d="M34.3913,30.0029,24.0007,48A23.994,23.994,0,0,0,44.78,12.0031H23.9989l-.0025.0093A11.985,11.985,0,0,1,34.3913,30.0029Z"
        style={{ fill: `url(#${gradientBId})` }}
      />
      <path
        d="M13.6086,30.0031,3.218,12.006A23.994,23.994,0,0,0,24.0025,48L34.3931,30.0029l-.0067-.0068a11.9852,11.9852,0,0,1-20.7778.007Z"
        style={{ fill: `url(#${gradientCId})` }}
      />
    </svg>
  )
}
