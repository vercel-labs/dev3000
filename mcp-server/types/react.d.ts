// Type declarations for experimental React features
import "react"

declare module "react" {
  export const ViewTransition: React.ComponentType<{
    children: React.ReactNode
  }>
}
