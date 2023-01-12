import "../styles/globals.scss"
import "tailwindcss/tailwind.css"
import type { AppProps } from "next/app"
import { ethers } from "ethers"
import { Client } from "@xmtp/xmtp-js"
import { useEffect, useState } from "react"
import { AppContext } from "../context"

function MyApp({ Component, pageProps }: AppProps) {
    const [xmtpClient, setXmtpClient] = useState<Client>()

    const createXmtpClient = async () => {
        // get the signer
        // @ts-ignore
        const provider = new ethers.providers.Web3Provider(window.ethereum)
        const signer = provider.getSigner()

        const keys = await Client.getKeys(signer, {
            env: "production",
            appVersion: "My_app" + "/" + "1.0",
        })

        const client = await Client.create(null, {
            env: "production",
            appVersion: "My_app" + "/" + "1.0",
            privateKeyOverride: keys,
        })
        setXmtpClient(client)
    }

    useEffect(() => {
        createXmtpClient()
    }, [])

    return (
        <AppContext.Provider
            value={{
                xmtpClient,
            }}
        >
            <Component {...pageProps} />
        </AppContext.Provider>
    )
}

export default MyApp
