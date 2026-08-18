package store.pos.handy

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

//	Wire shapes for the POS API. Unknown keys are ignored, so the server can grow fields
//	without every handy in the store needing a new build.

@Serializable
data class Category( val code: String, val name: String = "", val order: Int = 0 )

@Serializable
data class ItemOption( val code: String, val name: String = "", val price: Int = 0 )

@Serializable
data class MenuItem(
	val code		: String
,	val category	: String = ""
,	val name		: String = ""
,	val price		: Int = 0
,	val tax			: Int = 10
,	val station		: String = "kitchen"
,	val sold_out	: Boolean = false
,	val order		: Int = 0
,	val options		: List< ItemOption > = emptyList()
)

@Serializable
data class Menu(
	val version		: String = ""
,	val categories	: List< Category > = emptyList()
,	val items		: List< MenuItem > = emptyList()
)

@Serializable
data class OpenOrder(
	val order_id	: String
,	val number		: String = ""
,	val guests		: Int = 0
,	val opened_at	: String = ""
,	val tickets		: Int = 0
,	val total		: Int = 0
)

@Serializable
data class TableView(
	val code	: String
,	val name	: String = ""
,	val seats	: Int = 0
,	val area	: String = ""
,	val order	: Int = 0
,	@SerialName( "open" ) val openOrder: OpenOrder? = null
)

@Serializable
data class TaxLine( val rate: Int = 0, val base: Int = 0, val amount: Int = 0 )

@Serializable
data class Payment( val method: String, val amount: Int )

@Serializable
data class Bill(
	val subtotal	: Int = 0
,	val discount	: Int = 0
,	val total		: Int = 0
,	val tax			: List< TaxLine > = emptyList()
,	val payments	: List< Payment > = emptyList()
,	val paid		: Int = 0
,	val change		: Int = 0
)

@Serializable
data class TicketLine(
	val no		: Int = 0
,	val item	: String = ""
,	val name	: String = ""
,	val qty		: Int = 0
,	val price	: Int = 0
,	val tax		: Int = 10
,	val station	: String = ""
,	val options	: List< ItemOption > = emptyList()
,	val note	: String = ""
,	val state	: String = "queued"
)

@Serializable
data class Ticket(
	val ticket_id	: String
,	val order_id	: String = ""
,	val number		: String = ""
,	val table		: String = ""
,	val seq			: Int = 0
,	val at			: String = ""
,	val state		: String = "queued"
,	val lines		: List< TicketLine > = emptyList()
)

@Serializable
data class OrderView(
	val order_id	: String
,	val number		: String = ""
,	val table		: String = ""
,	val guests		: Int = 0
,	val opened_at	: String = ""
,	val closed_at	: String? = null
,	val tickets		: List< Ticket > = emptyList()
,	val bill		: Bill = Bill()
)

//	Requests. Every one of these carries an id the handy generated, so the outbox can repeat
//	it after a lost response without the kitchen or the till seeing it twice.

@Serializable
data class OpenRequest( val order_id: String, val table: String, val guests: Int, val terminal: String )

@Serializable
data class LineRequest( val item: String, val qty: Int, val options: List< String > = emptyList(), val note: String = "" )

@Serializable
data class TicketRequest( val ticket_id: String, val order_id: String, val terminal: String, val lines: List< LineRequest > )

@Serializable
data class CloseRequest( val payments: List< Payment >, val discount: Int = 0, val note: String = "", val terminal: String )

@Serializable
data class VoidRequest( val line: Int, val reason: String = "", val terminal: String )
