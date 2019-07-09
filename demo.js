const Web3Utils = require('web3-utils')
const fetch = require('node-fetch')
const Web3 = require('web3')
const url = "http://54.219.186.210:22000"
const web3 = new Web3(url)

async function send() { 
const serializedTx = await web3.eth.accounts.signTransaction(
    {
      nonce: Number(202),
      // chainId: 6565,
      to: '0x6FBfFEa11DE31044C669640bB9C1E256fDdCBceC',
      data: '0x995b2cff00000000000000000000000041a06892815a450c8bb7297c65290a086487167700000000000000000000000000000000000000000000000029a2241af62c0000c950273cce300a89b1a6b990c5e9c2e2c8b1df7bd1b3850cb858791a0f7e450f',
      value: Web3Utils.toWei('0'),
      gasPrice: 0,
      gas: 12000000
    },
    `0x8E4E96A917DF1E82E84B26D7F0CB3BC36DAF03FAC60D81591EED0382F905E2E4`
  )
  
console.log(serializedTx.rawTransaction)

// const from = await web3.eth.accounts.recoverTransaction(serializedTx.rawTransaction)
// console.log(from)
// console.log('0x41a06892815a450c8bB7297C65290a0864871677')
 
const url = "http://54.219.186.210:22000"
const response = await fetch(url, {
    headers: {
    'Content-type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'eth_sendRawTransaction',
    params: [serializedTx.rawTransaction],
    id: Math.floor(Math.random() * 100) + 1
    })
})

console.log("Response Status " + response.statusText)    
  if (!response.ok) {
    console.log("response error")
    throw new Error(response.statusText)
  }

  // return response
  const result = await response.json()
  console.log(result)
  return result
}

const res = send()