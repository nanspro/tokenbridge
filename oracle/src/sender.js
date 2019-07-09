require('../env')
const path = require('path')
const { connectSenderToQueue } = require('./services/amqpClient')
const { redis, redlock } = require('./services/redisClient')
const GasPrice = require('./services/gasPrice')
const logger = require('./services/logger')
const rpcUrlsManager = require('./services/getRpcUrlsManager')
const { sendTx } = require('./tx/sendTx')
const { getNonce, getChainId } = require('./tx/web3')
const {
  addExtraGas,
  checkHTTPS,
  privateKeyToAddress,
  syncForEach,
  waitForFunds,
  watchdog,
  nonceError
} = require('./utils/utils')
const { EXIT_CODES, EXTRA_GAS_PERCENTAGE } = require('./utils/constants')

const { VALIDATOR_ADDRESS_PRIVATE_KEY, REDIS_LOCK_TTL } = process.env

const VALIDATOR_ADDRESS = privateKeyToAddress(VALIDATOR_ADDRESS_PRIVATE_KEY)

if (process.argv.length < 3) {
  logger.error('Please check the number of arguments, config file was not provided')
  process.exit(EXIT_CODES.GENERAL_ERROR)
}

const config = require(path.join('../config/', process.argv[2]))

const web3Instance = config.web3
const nonceLock = `lock:${config.id}:nonce`
const nonceKey = `${config.id}:nonce`
let chainId = 0

async function initialize() {
  try {
    const checkHttps = checkHTTPS(process.env.ALLOW_HTTP, logger)

    rpcUrlsManager.homeUrls.forEach(checkHttps('home'))
    rpcUrlsManager.foreignUrls.forEach(checkHttps('foreign'))

    GasPrice.start(config.id)

    chainId = await getChainId(config.id)
    connectSenderToQueue({
      queueName: config.queue,
      cb: options => {
        if (config.maxProcessingTime) {
          return watchdog(() => main(options), config.maxProcessingTime, () => {
            logger.fatal('Max processing time reached')
            process.exit(EXIT_CODES.MAX_TIME_REACHED)
          })
        }

        return main(options)
      }
    })
  } catch (e) {
    logger.error(e.message)
    process.exit(EXIT_CODES.GENERAL_ERROR)
  }
}

function resume(newBalance) {
  logger.info(
    `Validator balance changed. New balance is ${newBalance}. Resume messages processing.`
  )
  initialize()
}

async function readNonce(forceUpdate) {
  logger.debug('Reading nonce')
  if (forceUpdate) {
    logger.debug('Forcing update of nonce')
    return 415//getNonce(web3Instance, VALIDATOR_ADDRESS)
  }

  let nonce = await redis.get(nonceKey)
  if (nonce) {
    logger.debug({ nonce }, 'Nonce found in the DB')
    if (Number(nonce) <= 415){
      nonce = 415
    }
    console.log("nonce in database" + nonce)
    return Number(nonce)
  // } else {
  //   logger.debug("Nonce wasn't found in the DB")
  //   console.log("nonce from blockchain")
  //   console.log(getNonce(web3Instance, VALIDATOR_ADDRESS))
  //   return 410
  }
}

function updateNonce(nonce) {
  return redis.set(nonceKey, nonce)
}

async function main({ msg, ackMsg, nackMsg, channel, scheduleForRetry }) {
  try {
    if (redis.status !== 'ready') {
      nackMsg(msg)
      return
    }

    const txArray = JSON.parse(msg.content)
    logger.info(`Msg received with ${txArray.length} Tx to send`)
    const gasPrice = GasPrice.getPrice()
    console.log("Gasssssss Price" + gasPrice)

    const ttl = REDIS_LOCK_TTL * txArray.length

    logger.debug('Acquiring lock')
    const lock = await redlock.lock(nonceLock, ttl)

    let nonce = await readNonce()
    console.log("LOLLLL" + nonce)
    // nonce = 204
    let insufficientFunds = false
    let minimumBalance = null
    const failedTx = []

    logger.debug(`Sending ${txArray.length} transactions`)
    await syncForEach(txArray, async job => {
      const gasLimit = 12000000 //addExtraGas(job.gasEstimate, EXTRA_GAS_PERCENTAGE)
      console.log(config.id)
      
      try {
        logger.info(`Sending transaction with nonce ${nonce}`)
        logger.info('Private Key' ,VALIDATOR_ADDRESS_PRIVATE_KEY)
        console.log("PrivKey" + VALIDATOR_ADDRESS_PRIVATE_KEY)        
        console.log("1." + config.id)
        console.log("2." + job.data)
        console.log("3." + job.to)
        console.log("4." + chainId)
        console.log("5." + web3Instance)
        
        const txHash = await sendTx({
          chain: config.id,
          data: job.data,
          nonce,
          gasPrice,
          amount: '0',
          gasLimit,
          privateKey: VALIDATOR_ADDRESS_PRIVATE_KEY,
          to: job.to,
          chainId,
          web3: web3Instance
        })

        console.log("8." + txHash)
        nonce++
        logger.info(
          { eventTransactionHash: job.transactionReference, generatedTransactionHash: txHash },
          `Tx generated ${txHash} for event Tx ${job.transactionReference}`
        )
      } catch (e) {
        logger.error(
          { eventTransactionHash: job.transactionReference, error: e.message },
          `Tx Failed for event Tx ${job.transactionReference}.`,
          e.message
        )
        if (!e.message.includes('Transaction with the same hash was already imported')) {
          failedTx.push(job)
        }

        if (e.message.includes('Insufficient funds')) {
          insufficientFunds = true
          const currentBalance = await web3Instance.eth.getBalance(VALIDATOR_ADDRESS)
          minimumBalance = gasLimit.multipliedBy(gasPrice)
          logger.error(
            `Insufficient funds: ${currentBalance}. Stop processing messages until the balance is at least ${minimumBalance}.`
          )
        } else if (nonceError(e)) {
          nonce = await readNonce(true)
        }
      }
    })

    logger.debug('Updating nonce')
    await updateNonce(nonce)

    logger.debug('Releasing lock')
    await lock.unlock()

    if (failedTx.length) {
      logger.info(`Sending ${failedTx.length} Failed Tx to Queue`)
      await scheduleForRetry(failedTx, msg.properties.headers['x-retries'])
    }
    ackMsg(msg)
    logger.debug(`Finished processing msg`)

    if (insufficientFunds) {
      logger.warn(
        'Insufficient funds. Stop sending transactions until the account has the minimum balance'
      )
      channel.close()
      waitForFunds(web3Instance, VALIDATOR_ADDRESS, minimumBalance, resume, logger)
    }
  } catch (e) {
    logger.error(e)
    nackMsg(msg)
  }

  logger.debug('Finished')
}

initialize()
