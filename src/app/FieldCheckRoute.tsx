import FieldCheck from '../fieldcheck/FieldCheck'
import '../styles/fieldcheck.css'

/** The Field check page (the M0 phone test) in its own dark, plain look, outside the device shell. */
export default function FieldCheckRoute() {
  return (
    <div className="fc-root">
      <FieldCheck />
    </div>
  )
}
