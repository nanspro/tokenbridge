const Web3Utils = require('web3-utils')
const fetch = require('node-fetch')
const rpcUrlsManager = require('../services/getRpcUrlsManager')

// eslint-disable-next-line consistent-return
async function sendTx({
  chain,
  privateKey,
  data,
  nonce,
  gasPrice,
  amount,
  gasLimit,
  to,
  chainId,
  web3
}) {
  console.log("6.0 " + chainId)
  const serializedTx = await web3.eth.accounts.signTransaction(
    {
      nonce: Number(nonce),
      // chainId,
      to,
      data,
      value: Web3Utils.toWei(amount),
      gasPrice,
      gas: gasLimit
    },
    `0x${privateKey}`
  )
  
  console.log(serializedTx.rawTransaction)
  return sendRawTx({
    chain,
    method: 'eth_sendRawTransaction',
    params: [serializedTx.rawTransaction]
  })
}

// eslint-disable-next-line consistent-return
async function sendRawTx({ chain, params, method }) {
  const result = await rpcUrlsManager.tryEach(chain, async url => {
    // curl -X POST --data '{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":[{see above}],"id":1}'
    console.log("6.url" + url)
    console.log("7.HomeUrl" + process.env.HOME_RPC_URL)
    const response = await fetch(url, {
      headers: {
        'Content-type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Math.floor(Math.random() * 100) + 1
      })
    })
    
    console.log("7.Response" + response.statusText)    
    if (!response.ok) {
      console.log("response error")
      throw new Error(response.statusText)
    }

    return response
    // const result = await response.json()
    // console.log(result)
    // return response
  })

  const json = await result.json()
  console.log("7.1 " + json.result)
  if (json.error) {
    console.log("Json Error")
    throw json.error
  }
  console.log(json.result)
  return json.result
}

module.exports = {
  sendTx,
  sendRawTx
}
