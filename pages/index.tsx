import type { NextPage } from "next"
import { useContext, useEffect, useState } from "react"
import { AppContext } from "../context"
import {
    Client,
    Conversation,
    DecodedMessage,
    SortDirection,
    Stream,
} from "@xmtp/xmtp-js"
import { ethers } from "ethers"

const typeMap = {
    Comment: "Comment",
    Mirror: "Mirror",
    Post: "Post",
}

const conversationMatchesProfile = (profileId: string) =>
    new RegExp(`lens.dev/dm/.*${profileId}`)

const buildConversationKey = (peerAddress: string, conversationId: string) =>
    `${peerAddress.toLowerCase()}/${conversationId}`

const getProfileFromKey = (key: string) => {
    const parsed = parseConversationKey(key)
    const userProfileId = "0x018fe5"
    if (!parsed || !userProfileId) {
        return null
    }

    return parsed.members.find((member) => member !== userProfileId) ?? null
}

export const parseConversationKey = (conversationKey: string) => {
    const CONVERSATION_KEY_RE = /^(.*)\/lens\.dev\/dm\/(.*)-(.*)$/
    const matches = conversationKey.match(CONVERSATION_KEY_RE)
    if (!matches || matches.length !== 4) {
        return null
    }

    const [, peerAddress, memberA, memberB] = Array.from(matches)

    return {
        peerAddress,
        members: [memberA, memberB],
        conversationId: `lens.dev/dm/${memberA}-${memberB}`,
    }
}

const Home: NextPage = () => {
    const [conversationStream, setConversationStream] =
        useState<Stream<Conversation>>()
    const [conversations, setConversations] = useState(new Map())
    const [messageStreams, setMessageStreams] = useState(new Map())
    const [profileIds, setProfileIds] = useState(new Set())
    const [previewMessage, setPreviewMessage] = useState<DecodedMessage>()
    const [previewMessages, setPreviewMessages] = useState<
        Map<string, DecodedMessage>
    >(new Map())

    const { xmtpClient }: { xmtpClient: Client } = useContext(AppContext)

    const PREFIX = "lens.dev/dm"

    const buildConversationId = (profileIdA: string, profileIdB: string) => {
        const profileIdAParsed = parseInt(profileIdA, 16)
        const profileIdBParsed = parseInt(profileIdB, 16)
        return profileIdAParsed < profileIdBParsed
            ? `${PREFIX}/${profileIdA}-${profileIdB}`
            : `${PREFIX}/${profileIdB}-${profileIdA}`
    }

    const initializeConversation = async () => {
        console.log("Initializing conversation...")
        const conversation = await xmtpClient.conversations.newConversation(
            "0xED5A704De64Ff9699dB62d09248C8d179bb77D8A",
            {
                conversationId: buildConversationId("0x018fe5", "0x019955"),
                metadata: {},
            }
        )

        console.log("Conversation initialized !")
        console.log("Sending conversation...")

        await conversation.send("Yo ! this thing works !")

        console.log("Conversation sent !")
    }

    // STREAM CONVERSATIONS
    const streamConversations = async () => {
        closeConversationStream()

        // const newStream = (await xmtpClient?.conversations?.stream()) || [];
        const newStream: Stream<Conversation> =
            await xmtpClient.conversations.stream()
        console.log("newStream", newStream)
        setConversationStream(newStream)
        const matcherRegex = conversationMatchesProfile("0x018fe5")

        for await (const convo of newStream) {
            console.log("Inside the for loop")
            console.log("convo", convo)
            // Ignore any new conversations not matching the current profile
            if (
                !convo.context?.conversationId ||
                !matcherRegex.test(convo.context.conversationId)
            ) {
                continue
            }
            const newConversations = new Map(conversations)
            const newProfileIds = new Set(profileIds)
            const key = buildConversationKey(
                convo.peerAddress,
                convo.context.conversationId
            )
            newConversations.set(key, convo)
            const profileId = getProfileFromKey(key)
            if (profileId && !profileIds.has(profileId)) {
                newProfileIds.add(profileId)
                setProfileIds(newProfileIds)
            }
            setConversations(newConversations)
            streamMessages(key, convo)
        }
    }

    const closeConversationStream = async () => {
        if (!conversationStream) {
            return
        }
        await conversationStream.return()
    }

    const streamMessages = async (
        conversationKey: string,
        conversation: Conversation
    ) => {
        if (!conversation.context || messageStreams.has(conversationKey)) {
            console.log("returning null to streamMessages()")
            return
        }
        const stream = await conversation.streamMessages()
        console.log("Stream", stream)
        messageStreams.set(conversationKey, stream)
        setMessageStreams(new Map(messageStreams))

        // todo -> this for loop is not resolving
        for await (const message of stream) {
            console.log("Message", message)
            setPreviewMessage(message)
        }
    }

    // LIST MESSAGES
    const listConversations = async () => {
        console.log("Loading messages...")
        const newPreviewMessages = new Map(previewMessages)
        const newConversations = new Map(conversations)
        const newProfileIds = new Set(profileIds)
        const convos = await xmtpClient.conversations.list()
        const matcherRegex = conversationMatchesProfile("0x018fe5")
        const matchingConvos = convos.filter(
            (convo) =>
                convo.context?.conversationId &&
                matcherRegex.test(convo.context.conversationId)
        )

        for (const convo of matchingConvos) {
            const key = buildConversationKey(
                convo.peerAddress,
                // @ts-ignore
                convo.context?.conversationId
            )
            console.log("messages", await convo.messages())
            newConversations.set(key, convo)
            streamMessages(key, convo)
        }

        const previews = await Promise.all(
            matchingConvos.map(fetchMostRecentMessage)
        )

        for (const preview of previews) {
            // @ts-ignore
            const profileId = getProfileFromKey(preview?.key)
            if (profileId) {
                newProfileIds.add(profileId)
            }
            if (preview?.message) {
                newPreviewMessages.set(preview.key, preview.message)
            }
        }
        console.log("newPreviewMessages => ", newPreviewMessages)
        console.log("newConversations => ", newConversations)
        setPreviewMessages(newPreviewMessages)
        setConversations(newConversations)
        console.log("Messages loaded !")
        if (newProfileIds.size > profileIds.size) {
            setProfileIds(newProfileIds)
        }
    }

    const fetchMostRecentMessage = async (convo: Conversation) => {
        if (!convo?.context?.conversationId) return

        const key = buildConversationKey(
            convo.peerAddress,
            convo?.context?.conversationId
        )

        const newMessages = await convo.messages({
            limit: 1,
            direction: SortDirection.SORT_DIRECTION_DESCENDING,
        })
        if (newMessages.length <= 0) {
            return { key }
        }
        return { key, message: newMessages[0] }
    }

    useEffect(() => {
        if (xmtpClient) {
            streamConversations()
            // listConversations()
            // buildConversationId()
        }
        return () => {
            closeConversationStream()
            // closeMessageStreams();
        }
    }, [xmtpClient])

    return <div></div>
}

export default Home
