import React, { useCallback, useEffect, useState } from 'react'
import Web3 from 'web3'
import { ToastContainer, toast } from 'react-toastify'
import { PolyjuiceHttpProvider } from '@polyjuice-provider/web3'
import { AddressTranslator, BridgeRPCHandler } from 'nervos-godwoken-integration'
import detectEthereumProvider from '@metamask/detect-provider'

import { log } from 'util'
import ERC20JSON from '../../build/contracts/ERC20.json'

import './app.scss'
import { AdoptionWrapper } from '../lib/contracts/AdoptionWrapper'
import { ZERO_ADDRESS } from '../lib/constants'
import pets from '../pets'

const LoadingIndicator = () => <span className="rotating-icon">⚙️</span>

const bridgeRpc = new BridgeRPCHandler(
    'https://force-bridge-test.ckbapp.dev/api/force-bridge/api/v1'
)

export function App() {
    const [provider, setProvider] = useState<any>()
    const [web3, setWeb3] = useState<Web3>()
    const [account, setAccount] = useState<string>()
    const [adopters, setAdopters] = useState<string[]>()
    const [contract, setContract] = useState<AdoptionWrapper>()
    const [polyjuiceAddress, setPolyjuiceAddress] = useState<string | undefined>()
    const [sudtBalance, setSudtBalance] = useState<number>()
    const [l2Balance, setL2Balance] = useState<bigint>()
    const [l2Address, setL2Address] = useState<string>()
    const [transactionInProgress, setTransactionInProgress] = useState(false)
    const toastId = React.useRef(null)

    const fetchPolyjuiceBalance = useCallback(
        async address => {
            try {
                const balance = await web3.eth.getBalance(address)
                setL2Balance(BigInt(balance))
            } catch (error) {
                console.error(error)
                setL2Balance(undefined)
            }
        },
        [web3]
    )

    const handleAccountsChanged = useCallback(
        (accounts: Array<string>) => {
            const [_account] = accounts
            setAccount(_account)

            if (_account) {
                toast('Wallet connected')
            } else {
                toast.warning('Wallet disconnected')
            }
        },
        [account]
    )

    async function fetchAdopters() {
        const _adopters = await contract.getAdopters()
        setAdopters(_adopters)
    }

    const adoptPet = useCallback(
        async (petId: number) => {
            try {
                setTransactionInProgress(true)
                await contract.adopt(petId, account)
                toast('Adopted pet :)')
                await fetchAdopters()
            } catch (error) {
                console.error(error)
                toast.error('There was an error adopting your pet')
            } finally {
                setTransactionInProgress(false)
            }
        },
        [contract, account]
    )

    const abandonPet = useCallback(
        async (petId: number) => {
            try {
                setTransactionInProgress(true)
                await contract.abandon(petId, account)
                toast('Abandoned pet :(')
                await fetchAdopters()
            } catch (error) {
                console.error(error)
                toast.error('There was an error abandoning your pet')
            } finally {
                setTransactionInProgress(false)
            }
        },
        [contract, account]
    )

    const getOwnerText = (petId: number) => {
        if (!adopters) {
            return LoadingIndicator()
        }
        if (adopters?.[petId] === ZERO_ADDRESS) {
            return 'None :('
        }
        if (adopters?.[petId].toLowerCase() === polyjuiceAddress) {
            return 'Me'
        }
        return adopters?.[petId]
    }
    useEffect(() => {
        ;(async () => {
            const _provider = await detectEthereumProvider()
            if (!_provider) {
                console.log('No provider detected, consider using metamask')
                return
            }
            setProvider(_provider)

            const providerConfig = {
                rollupTypeHash: process.env.ROLLUP_TYPE_HASH,
                ethAccountLockCodeHash: process.env.ETH_ACCOUNT_LOCK_CODE_HASH,
                web3Url: process.env.WEB3_PROVIDER_URL
            }

            const httpProvider = new PolyjuiceHttpProvider(
                process.env.WEB3_PROVIDER_URL,
                providerConfig
            )
            const _web3 = new Web3(httpProvider || Web3.givenProvider)
            setWeb3(_web3)
        })()

        const intervalId = setInterval(() => {
            if (!polyjuiceAddress) {
                return
            }
            fetchPolyjuiceBalance(polyjuiceAddress)
        }, 5000)

        return () => {
            clearInterval(intervalId)
        }
    }, [])

    useEffect(() => {
        if (!provider) {
            return
        }
        if (provider !== window.ethereum) {
            console.error('Do you have multiple wallets installed?')
            toast.error('Unknown wallet provider.')
        }

        provider.on('accountsChanged', handleAccountsChanged)
        provider.request({ method: 'eth_accounts' }).then(async (accounts: Array<string>) => {
            if (accounts.length) {
                // only requestAccount if accounts are already accessible
                try {
                    const _accounts = await provider.request({ method: 'eth_requestAccounts' })
                    await handleAccountsChanged(_accounts)
                } catch (error) {
                    if (error?.code === -32002) {
                        // already pending
                        toast.info('Please open Metamask to confirm.')
                        return
                    }
                    console.error(error)
                }
            }
        })

        const godwokenRpcUrl = process.env.WEB3_PROVIDER_URL
        const providerConfig = {
            rollupTypeHash: process.env.ROLLUP_TYPE_HASH,
            ethAccountLockCodeHash: process.env.ETH_ACCOUNT_LOCK_CODE_HASH,
            web3Url: godwokenRpcUrl
        }

        const httpProvider = new PolyjuiceHttpProvider(godwokenRpcUrl, providerConfig)
        const _web3 = new Web3(httpProvider || Web3.givenProvider)
        setWeb3(_web3)
    }, [provider])

    useEffect(() => {
        if (!web3) {
            return
        }
        setContract(new AdoptionWrapper(web3))
    }, [web3])

    useEffect(() => {
        if (!contract) {
            return
        }

        fetchAdopters()
    }, [contract])

    useEffect(() => {
        if (account) {
            const addressTranslator = new AddressTranslator()
            const _polyjuiceAddress = addressTranslator.ethAddressToGodwokenShortAddress(account)
            setPolyjuiceAddress(_polyjuiceAddress)
            fetchPolyjuiceBalance(_polyjuiceAddress)
            addressTranslator.getLayer2DepositAddress(web3, account).then(depositAddress => {
                setL2Address(depositAddress.addressString)
            })

            // get balance in SUDT
            const sudt = new web3.eth.Contract(
                ERC20JSON.abi as any,
                process.env.SUDT_PROXY_CONTRACT_ADDRESS
            )
            sudt.methods
                .balanceOf(_polyjuiceAddress)
                .call({ from: account })
                .then(setSudtBalance)
                .catch(error => {
                    console.error(error)
                    setSudtBalance(undefined)
                })
        } else {
            setPolyjuiceAddress(undefined)
            setL2Balance(undefined)
            setSudtBalance(undefined)
        }
    }, [account])

    useEffect(() => {
        if (transactionInProgress && !toastId.current) {
            toastId.current = toast.info(
                'Transaction in progress. Confirm MetaMask signing dialog and please wait...',
                {
                    position: 'top-right',
                    autoClose: false,
                    hideProgressBar: false,
                    closeOnClick: false,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                    closeButton: false
                }
            )
        } else if (!transactionInProgress && toastId.current) {
            toast.dismiss(toastId.current)
            toastId.current = null
        }
    }, [transactionInProgress, toastId.current])

    function getPetActions(petId: number) {
        if (!l2Balance) {
            // l2balance is required to use this service
            return <br />
        }
        if (account && adopters?.[petId] === ZERO_ADDRESS) {
            return (
                <button
                    className="btn btn-success w-100"
                    type="button"
                    disabled={transactionInProgress}
                    onClick={() => adoptPet(petId)}
                >
                    Adopt
                </button>
            )
        }
        if (adopters && adopters[petId].toLowerCase() === polyjuiceAddress) {
            return (
                <div>
                    <button
                        className="btn btn-warning w-100"
                        type="button"
                        disabled={transactionInProgress}
                        onClick={() => abandonPet(petId)}
                    >
                        Abandon
                    </button>
                </div>
            )
        }
        return <br />
    }

    return (
        <div>
            <div className="container">
                <h1 className="text-center">Pet Shop</h1>
                <hr />
                <p>
                    Click{' '}
                    <a
                        href="https://force-bridge-test.ckbapp.dev/bridge/Ethereum/Nervos?xchain-asset=0x0000000000000000000000000000000000000000"
                        target="_blank"
                    >
                        here
                    </a>{' '}
                    to transfer funds to your layer 2 address and make sure to specify your
                    receiving address in the recipient field: <br />
                    <b>{l2Address} </b>
                </p>

                <hr />
                {l2Address && !l2Balance && (
                    <div>
                        <b className="text-danger font-italic">
                            Insufficient Balance. Please transfer ETH to your l2 address using the
                            instructions above.
                        </b>
                        <hr />
                    </div>
                )}
                <div>
                    {provider && !account && (
                        <button
                            className="btn btn-primary"
                            onClick={() => provider.request({ method: 'eth_requestAccounts' })}
                        >
                            Enable Ethereum
                        </button>
                    )}
                    {account && (
                        <div>
                            <div className="text-truncate">
                                Your ETH address: <b>{account}</b>
                            </div>
                            <div className="text-truncate">
                                Pet shop contract address: <b>{contract?.address || '-'}</b>
                            </div>
                            <div className="text-truncate">
                                Polyjuice address: <b>{polyjuiceAddress || ' - '}</b>
                            </div>
                            <div className="text-truncate">
                                SUDT contract address:{' '}
                                <b>{process.env.SUDT_PROXY_CONTRACT_ADDRESS || ' - '}</b>
                            </div>
                            <div className="text-truncate">
                                SUDT balance: <b>{sudtBalance || ' - '}</b>
                            </div>

                            <div className="text-truncate">
                                Nervos Layer 2 address: <b>{l2Address || ' - '}</b>
                            </div>
                            <div className="text-truncate">
                                Nervos Layer 2 balance:{' '}
                                <b>
                                    {l2Balance !== undefined
                                        ? `${(l2Balance / 10n ** 8n).toString()} CKB`
                                        : ' - '}
                                </b>
                            </div>
                        </div>
                    )}
                </div>

                <hr />

                <div className="row">
                    {pets.map(pet => {
                        return (
                            <div className="col-sm-12 col-md-6 col-lg-4 mb-4" key={pet.id}>
                                <div className="card">
                                    <img
                                        alt="nothing"
                                        className="card-img-top"
                                        src={`images/${pet.name
                                            .toLowerCase()
                                            .replace(/\s/g, '-')}.png`}
                                        data-holder-rendered="true"
                                    />

                                    <div className="card-body">
                                        <h3 className="card-title">{pet.name}</h3>
                                        <div className="card-text">
                                            <div className="text-truncate">
                                                <strong>Owner:</strong>{' '}
                                                <span>{getOwnerText(pet.id)}</span>
                                            </div>
                                            <strong>Breed</strong>:{' '}
                                            <span className="pet-breed">{pet.breed}</span>
                                            <br />
                                            <strong>Age</strong>:{' '}
                                            <span className="pet-age">{pet.age}</span>
                                            <br />
                                            <strong>Location</strong>:{' '}
                                            <span className="pet-location">{pet.location}</span>
                                        </div>
                                    </div>
                                    <div className="card-footer">{getPetActions(pet.id)}</div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            <ToastContainer newestOnTop={true} />
        </div>
    )
}
