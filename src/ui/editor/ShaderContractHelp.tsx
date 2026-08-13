import { SHADER_CONTRACT } from '../../three/shaders/contract'

const CONTRACT_SOURCE = [...SHADER_CONTRACT.preamble, '', SHADER_CONTRACT.output].join('\n')

export function ShaderContractHelp() {
  return (
    <details className="shader-contract-help">
      <summary>Shader contract</summary>
      <p>The application provides these declarations around the fragment shader body.</p>
      <pre><code>{CONTRACT_SOURCE}</code></pre>
    </details>
  )
}
